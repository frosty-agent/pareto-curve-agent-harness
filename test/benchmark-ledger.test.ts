import assert from "node:assert/strict";
import { appendFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { BenchmarkLedger } from "../src/benchmark-ledger.js";

async function ledger() { return BenchmarkLedger.open(await mkdtemp(join(tmpdir(), "pareto-ledger-test-"))); }

test("reserves $9 before dispatch and settles complete actual provider cost", async () => {
  const value = await ledger();
  const reservation = await value.reserve({ systemId: "pareto", taskId: "task-1" });
  assert.ok("id" in reservation);
  await value.settle(reservation, { knownActualCostUsd: 0.37, costAccountingComplete: true });
  const snapshot = value.status();
  assert.equal(snapshot.actualCostUsd, 0.37);
  assert.equal(snapshot.heldUsd, 0);
});

test("holds an incomplete-cost reservation so it cannot be treated as free", async () => {
  const value = await ledger();
  const reservation = await value.reserve({ systemId: "pareto", taskId: "task-1" });
  assert.ok("id" in reservation);
  await value.settle(reservation, { knownActualCostUsd: 0.2, costAccountingComplete: false });
  const snapshot = value.status();
  assert.equal(snapshot.actualCostUsd, 0.2);
  assert.equal(snapshot.heldUsd, 9);
  assert.equal(snapshot.reservations[reservation.id]?.terminal, "unscorable_hold");
});

test("enforces each $45 system cap against held reservations, leaving the $10 global contingency unspent", async () => {
  const value = await ledger();
  for (let index = 0; index < 5; index += 1) {
    const reservation = await value.reserve({ systemId: "pareto", taskId: `p-${index}` });
    assert.ok("id" in reservation);
  }
  const systemStop = await value.reserve({ systemId: "pareto", taskId: "p-5" });
  assert.deepEqual(systemStop, { stop: "budget_cap", scope: "system", message: "system $45 cap would be exceeded" });
  for (let index = 0; index < 5; index += 1) {
    const reservation = await value.reserve({ systemId: "fixed-openai-gpt-5.6-luna", taskId: `f-${index}` });
    assert.ok("id" in reservation);
  }
  assert.equal(value.status().heldUsd, 90);
});

test("replays a durable journal and ignores only a torn final JSON line", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pareto-ledger-replay-"));
  const first = await BenchmarkLedger.open(directory);
  const reservation = await first.reserve({ systemId: "pareto", taskId: "task-1" });
  assert.ok("id" in reservation);
  await first.settle(reservation, { knownActualCostUsd: 0.5, costAccountingComplete: true });
  await appendFile(join(directory, "ledger", "events.jsonl"), "{\"type\":", "utf8");
  const recovered = await BenchmarkLedger.open(directory);
  assert.equal(recovered.status().actualCostUsd, 0.5);
});
