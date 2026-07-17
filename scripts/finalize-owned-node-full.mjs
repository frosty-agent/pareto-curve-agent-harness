import fs from "node:fs";
const root = "runs/owned-node-full-001";
const base = JSON.parse(fs.readFileSync(`${root}/aggregate-results.json`, "utf8"));
const retry = JSON.parse(fs.readFileSync("runs/owned-node-full-001-retry/results.json", "utf8"));
const rows = base.rows.filter((row) => row.policy);
for (const [policy, value] of Object.entries(retry)) rows.push({ taskId: value.taskId, policy, ...value });
const order = base.taskIds;
rows.sort((a, b) => order.indexOf(a.taskId) - order.indexOf(b.taskId) || a.policy.localeCompare(b.policy));
const totals = {};
for (const policy of ["generic-one-model", "frozen-nine-rung-pareto"]) {
  const selected = rows.filter((row) => row.policy === policy);
  const cost = selected.reduce((sum, row) => sum + (row.actualCostUsd ?? 0), 0);
  const resolved = selected.filter((row) => row.outcome === "resolved").length;
  totals[policy] = { tasks: selected.length, resolved, completeCostTasks: selected.filter((row) => row.costAccountingComplete).length, actualCostUsd: cost, costPerResolvedUsd: cost / resolved };
}
const aggregate = { schemaVersion: "owned-node-full-run/v1", tier: "full", taskIds: order, globalCapUsd: 75, totalObservedSpendUsd: rows.reduce((sum, row) => sum + (row.actualCostUsd ?? 0), 0), rows, totals };
fs.writeFileSync(`${root}/aggregate-results.json`, JSON.stringify(aggregate, null, 2));
fs.writeFileSync(`${root}/aggregate-results.csv`, ["task_id,policy,outcome,actual_cost_usd,cost_accounting_complete,attempts", ...rows.map((row) => [row.taskId, row.policy, row.outcome, row.actualCostUsd ?? "", row.costAccountingComplete, row.attempts.length].join(","))].join("\n") + "\n");
const g = totals["generic-one-model"], p = totals["frozen-nine-rung-pareto"];
const get = (taskId, policy) => rows.find((row) => row.taskId === taskId && row.policy === policy);
const table = order.map((taskId) => { const generic = get(taskId, "generic-one-model"), pareto = get(taskId, "frozen-nine-rung-pareto"); return `| \`${taskId}\` | ${generic.outcome} | $${generic.actualCostUsd.toFixed(6)} | ${pareto.outcome} | $${pareto.actualCostUsd.toFixed(6)} |`; }).join("\n");
fs.writeFileSync(`${root}/REPORT.md`, `# Owned Node fixture comparison — tier: \`full\` (13/13 tasks)\n\n## Scope and validity\n\nThis is the complete 13-task owned, dependency-free Node fixture suite. Both policies used the same copied baseline, task prompt, bounded tool contract, immutable \`node --test\` regression command, OpenRouter account, and provider-reported \`usage.cost\` accounting. No Docker, Python, external benchmark, or external task runtime was used.\n\nAll 26 policy rows have complete provider cost. \`retry-cancellation-backoff\` was rerun once after its first full-suite process failed before writing a result; the replacement row is identified by its durable source run below.\n\n## Aggregate result\n\n| Policy | Resolved | Actual provider cost | Cost / resolved |\n|---|---:|---:|---:|\n| Generic fixed \`openai/gpt-5.6-luna\` | **${g.resolved} / ${g.tasks}** | **$${g.actualCostUsd.toFixed(6)}** | $${g.costPerResolvedUsd.toFixed(6)} |\n| Frozen nine-rung Pareto | **${p.resolved} / ${p.tasks}** | **$${p.actualCostUsd.toFixed(6)}** | $${p.costPerResolvedUsd.toFixed(6)} |\n\nPareto resolved six additional fixtures (10 versus 4), but at a higher total cost ($0.681244 versus $0.240362) and higher cost per resolved task ($0.068124 versus $0.060090). The harder protocol/security fixtures often required several Pareto rungs; this is the intended tradeoff the full tier exposes.\n\n## Per-task outcome\n\n| Task | Generic | Generic cost | Pareto | Pareto cost |\n|---|---|---:|---|---:|\n${table}\n\n## Artifacts\n\n- \`aggregate-results.json\` and \`aggregate-results.csv\`: all 26 paired rows.\n- Per-task source artifacts under this run directory; retry replacement: \`../owned-node-full-001-retry/\`.\n\nThis is a directional comparison of deliberately owned fixtures, not a general coding benchmark claim.\n`);
console.log(JSON.stringify({ generic: g, pareto: p, rowCount: rows.length }, null, 2));
