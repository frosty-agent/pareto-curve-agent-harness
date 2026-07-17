import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const output = resolve(process.argv[2] ?? `runs/owned-node-full-${new Date().toISOString().slice(0, 10)}`);
const cap = Number(process.env.OWN_HARNESS_GLOBAL_CAP_USD ?? "75");
if (!Number.isFinite(cap) || cap <= 0) throw new Error("OWN_HARNESS_GLOBAL_CAP_USD must be positive");
if (existsSync(output)) throw new Error(`output exists: ${output}`);
mkdirSync(output, { recursive: true });
const tiers = JSON.parse(readFileSync("fixtures/own-harness-tasks/tiers.json", "utf8"));
const taskIds = tiers.tiers.full.taskIds;
let spent = 0;
const rows = [];
for (const taskId of taskIds) {
  if (spent >= cap) {
    rows.push({ taskId, state: "not_dispatched_global_cap", globalSpentBeforeUsd: spent });
    continue;
  }
  const childOutput = `${output}/${taskId}`;
  const run = spawnSync(process.execPath, ["scripts/run-own-comparison.mjs", childOutput, taskId], { stdio: "inherit", env: process.env });
  if (run.status !== 0) {
    rows.push({ taskId, state: "runner_error", exitCode: run.status });
    continue;
  }
  const result = JSON.parse(readFileSync(`${childOutput}/results.json`, "utf8"));
  for (const [policy, value] of Object.entries(result)) {
    rows.push({ taskId, policy, ...value });
    if (value.costAccountingComplete) spent += value.actualCostUsd;
  }
}
const scored = rows.filter((row) => row.policy);
const totals = Object.fromEntries([["generic-one-model", "Generic GPT-5.6 Luna"], ["frozen-nine-rung-pareto", "Frozen Pareto"]].map(([policy]) => {
  const p = scored.filter((row) => row.policy === policy);
  const complete = p.filter((row) => row.costAccountingComplete);
  return [policy, { tasks: p.length, resolved: p.filter((row) => row.outcome === "resolved").length, completeCostTasks: complete.length, actualCostUsd: complete.reduce((n, row) => n + row.actualCostUsd, 0) }];
}));
const artifact = { schemaVersion: "owned-node-full-run/v1", tier: "full", taskIds, globalCapUsd: cap, totalObservedSpendUsd: spent, rows, totals };
writeFileSync(`${output}/aggregate-results.json`, JSON.stringify(artifact, null, 2));
const csv = ["task_id,policy,outcome,actual_cost_usd,cost_accounting_complete,attempts,state", ...rows.map((row) => [row.taskId, row.policy ?? "", row.outcome ?? "", row.actualCostUsd ?? "", row.costAccountingComplete ?? "", row.attempts?.length ?? "", row.state ?? ""].join(","))].join("\n") + "\n";
writeFileSync(`${output}/aggregate-results.csv`, csv);
const genericTotals = totals["generic-one-model"];
const paretoTotals = totals["frozen-nine-rung-pareto"];
const report = `# Owned Node fixture comparison — tier: full\n\n**Scope:** ${taskIds.length} ordered owned Node fixtures. Global spend guard: $${cap.toFixed(2)}; observed complete-cost spend: $${spent.toFixed(6)}.\n\n| Policy | Dispatched tasks | Resolved | Complete-cost tasks | Actual provider cost |\n|---|---:|---:|---:|---:|\n| Generic GPT-5.6 Luna | ${genericTotals.tasks} | ${genericTotals.resolved} | ${genericTotals.completeCostTasks} | $${genericTotals.actualCostUsd.toFixed(6)} |\n| Frozen Pareto | ${paretoTotals.tasks} | ${paretoTotals.resolved} | ${paretoTotals.completeCostTasks} | $${paretoTotals.actualCostUsd.toFixed(6)} |\n\nSee \`aggregate-results.json\` for every task-policy row and cap-stopped task. This is an owned-fixture directional study, not a general benchmark claim.\n`;
writeFileSync(`${output}/REPORT.md`, report);
console.log(report);
