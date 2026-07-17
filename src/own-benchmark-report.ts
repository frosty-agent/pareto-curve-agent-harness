export type OwnBenchmarkEvaluator = "resolved" | "unresolved" | "error" | "not_run";

export interface OwnBenchmarkResultRow {
  taskId: string;
  systemId: string;
  evaluator: OwnBenchmarkEvaluator;
  actualCostUsd?: number;
  costAccountingComplete: boolean;
  durationSeconds: number;
  stopReason: string;
}

export interface OwnBenchmarkReportInput {
  experimentId: string;
  systems: string[];
  results: OwnBenchmarkResultRow[];
}

export interface OwnBenchmarkReport {
  csv: string;
  markdown: string;
}

function csvField(value: string | number | boolean | undefined): string {
  if (value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function cost(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value.toFixed(6) : "";
}

function isScorable(row: OwnBenchmarkResultRow): boolean {
  return row.costAccountingComplete
    && typeof row.actualCostUsd === "number" && Number.isFinite(row.actualCostUsd) && row.actualCostUsd >= 0
    && (row.evaluator === "resolved" || row.evaluator === "unresolved");
}

function assertValid(input: OwnBenchmarkReportInput): void {
  if (!input.experimentId.trim()) throw new Error("experimentId is required");
  if (input.systems.length !== 2 || new Set(input.systems).size !== 2) throw new Error("exactly two unique systems are required");
  const seen = new Set<string>();
  for (const row of input.results) {
    if (!input.systems.includes(row.systemId)) throw new Error(`unknown system: ${row.systemId}`);
    if (!row.taskId.trim()) throw new Error("taskId is required");
    const key = `${row.taskId}\u0000${row.systemId}`;
    if (seen.has(key)) throw new Error(`duplicate task-system result: ${row.taskId}/${row.systemId}`);
    seen.add(key);
  }
}

/** Compact paired report: only public-evaluator results with complete actual cost are scored. */
export function renderOwnBenchmarkReport(input: OwnBenchmarkReportInput): OwnBenchmarkReport {
  assertValid(input);
  const taskIds = [...new Set(input.results.map((row) => row.taskId))].sort();
  const byKey = new Map(input.results.map((row) => [`${row.taskId}\u0000${row.systemId}`, row]));
  const pairedTaskIds = taskIds.filter((taskId) => input.systems.every((systemId) => {
    const row = byKey.get(`${taskId}\u0000${systemId}`);
    return row !== undefined && isScorable(row);
  }));
  const pairedRows = input.results.filter((row) => pairedTaskIds.includes(row.taskId));
  const auditRows = input.results.filter((row) => !pairedTaskIds.includes(row.taskId));

  const csv = [
    "task_id,system_id,evaluator,actual_cost_usd,cost_accounting_complete,duration_seconds,stop_reason,scorable",
    ...input.results.map((row) => [row.taskId, row.systemId, row.evaluator, cost(row.actualCostUsd), row.costAccountingComplete, row.durationSeconds, row.stopReason, isScorable(row)].map(csvField).join(",")),
  ].join("\n").concat("\n");

  const summaryRows = input.systems.map((systemId) => {
    const rows = pairedRows.filter((row) => row.systemId === systemId);
    const resolved = rows.filter((row) => row.evaluator === "resolved").length;
    const totalCost = rows.reduce((sum, row) => sum + (row.actualCostUsd ?? 0), 0);
    const costPerResolved = resolved ? `$${(totalCost / resolved).toFixed(6)}` : "—";
    return `| ${systemId} | ${resolved}/${rows.length} | $${totalCost.toFixed(6)} | ${costPerResolved} |`;
  });
  const markdown = [
    `# ${input.experimentId} — own-runner result`,
    "",
    `Paired scorable tasks: ${pairedTaskIds.length}/${taskIds.length}`,
    "",
    "| System | Resolved / paired | Actual cost (paired) | Cost / resolved |",
    "|---|---:|---:|---:|",
    ...summaryRows,
    "",
    `Unscorable/audit rows: ${auditRows.length}`,
    "",
    "See `results.csv` for one row per task/system. Costs are OpenRouter `usage.cost`; blank/missing cost is not treated as zero.",
    "",
  ].join("\n");
  return { csv, markdown };
}
