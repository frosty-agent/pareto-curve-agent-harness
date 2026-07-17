import { appendFile, mkdir, readFile, open } from "node:fs/promises";
import { join, resolve } from "node:path";

export type BenchmarkSystemId = "pareto" | "fixed-openai-gpt-5.6-luna";
export interface LedgerKey { systemId: BenchmarkSystemId; taskId: string; }
export interface Reservation { id: string; key: LedgerKey; reservedUsd: 9; }
export interface Settlement { knownActualCostUsd: number; costAccountingComplete: boolean; }
export interface BudgetStop { stop: "budget_cap" | "duplicate_task"; scope: "task" | "system" | "global"; message: string; }
export interface LedgerSnapshot {
  actualCostUsd: number;
  heldUsd: number;
  bySystem: Record<BenchmarkSystemId, { actualCostUsd: number; heldUsd: number }>;
  reservations: Record<string, { reservation: Reservation; terminal: "settled" | "unscorable_hold" | null; knownActualCostUsd: number }>;
}

type Event =
  | { type: "reserve"; sequence: number; reservation: Reservation }
  | { type: "settle"; sequence: number; reservationId: string; settlement: Settlement };

const emptySnapshot = (): LedgerSnapshot => ({
  actualCostUsd: 0, heldUsd: 0,
  bySystem: { pareto: { actualCostUsd: 0, heldUsd: 0 }, "fixed-openai-gpt-5.6-luna": { actualCostUsd: 0, heldUsd: 0 } },
  reservations: {},
});

function assertCost(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 9) throw new Error(`${label} must be a finite value between 0 and 9`);
}
function apply(snapshot: LedgerSnapshot, event: Event): void {
  if (event.type === "reserve") {
    const { reservation } = event;
    if (snapshot.reservations[reservation.id]) throw new Error(`duplicate reservation ${reservation.id}`);
    snapshot.reservations[reservation.id] = { reservation, terminal: null, knownActualCostUsd: 0 };
    snapshot.heldUsd += 9;
    snapshot.bySystem[reservation.key.systemId].heldUsd += 9;
    return;
  }
  const state = snapshot.reservations[event.reservationId];
  if (!state || state.terminal) throw new Error(`invalid settlement ${event.reservationId}`);
  assertCost(event.settlement.knownActualCostUsd, "knownActualCostUsd");
  state.knownActualCostUsd = event.settlement.knownActualCostUsd;
  snapshot.actualCostUsd += event.settlement.knownActualCostUsd;
  snapshot.bySystem[state.reservation.key.systemId].actualCostUsd += event.settlement.knownActualCostUsd;
  if (event.settlement.costAccountingComplete) {
    state.terminal = "settled";
    snapshot.heldUsd -= 9;
    snapshot.bySystem[state.reservation.key.systemId].heldUsd -= 9;
  } else state.terminal = "unscorable_hold";
}

export class BenchmarkLedger {
  private snapshot: LedgerSnapshot;
  private sequence: number;
  private constructor(private readonly journalPath: string, snapshot: LedgerSnapshot, sequence: number) { this.snapshot = snapshot; this.sequence = sequence; }

  static async open(runDirectory: string): Promise<BenchmarkLedger> {
    const ledgerDirectory = join(resolve(runDirectory), "ledger");
    await mkdir(ledgerDirectory, { recursive: true });
    const journalPath = join(ledgerDirectory, "events.jsonl");
    let content = "";
    try { content = await readFile(journalPath, "utf8"); } catch (error: unknown) { if (!(error as { code?: string }).code || (error as { code?: string }).code !== "ENOENT") throw error; }
    const snapshot = emptySnapshot();
    let sequence = 0;
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!line) continue;
      let event: Event;
      try { event = JSON.parse(line) as Event; } catch (error) {
        if (index === lines.length - 1) break; // tolerate only a torn final append
        throw new Error(`ledger journal corrupt at line ${index + 1}: ${String(error)}`);
      }
      if (event.sequence !== sequence + 1) throw new Error(`ledger sequence mismatch at line ${index + 1}`);
      apply(snapshot, event); sequence = event.sequence;
    }
    return new BenchmarkLedger(journalPath, snapshot, sequence);
  }

  status(): LedgerSnapshot { return structuredClone(this.snapshot); }

  async reserve(key: LedgerKey): Promise<Reservation | BudgetStop> {
    if (Object.values(this.snapshot.reservations).some((state) => state.reservation.key.systemId === key.systemId && state.reservation.key.taskId === key.taskId)) {
      return { stop: "duplicate_task", scope: "task", message: `task already reserved for ${key.systemId}` };
    }
    const system = this.snapshot.bySystem[key.systemId];
    if (system.actualCostUsd + system.heldUsd + 9 > 45) return { stop: "budget_cap", scope: "system", message: "system $45 cap would be exceeded" };
    if (this.snapshot.actualCostUsd + this.snapshot.heldUsd + 9 > 100) return { stop: "budget_cap", scope: "global", message: "global $100 cap would be exceeded" };
    const reservation: Reservation = { id: `${key.systemId}:${key.taskId}:${this.sequence + 1}`, key, reservedUsd: 9 };
    await this.append({ type: "reserve", sequence: this.sequence + 1, reservation });
    return reservation;
  }

  async settle(reservation: Reservation, settlement: Settlement): Promise<void> {
    await this.append({ type: "settle", sequence: this.sequence + 1, reservationId: reservation.id, settlement });
  }

  private async append(event: Event): Promise<void> {
    const handle = await open(this.journalPath, "a");
    try {
      await handle.writeFile(`${JSON.stringify(event)}\n`, "utf8");
      await handle.sync();
    } finally { await handle.close(); }
    apply(this.snapshot, event);
    this.sequence = event.sequence;
  }
}
