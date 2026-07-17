import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

function fail(message) { throw new Error(`owned-node-suite: ${message}`); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) fail(`unexpected argument ${token}`);
    const key = token.slice(2);
    if (["include-pareto", "dry-run", "resume"].includes(key)) { values[key] = true; continue; }
    const value = argv[++index];
    if (!value || value.startsWith("--")) fail(`missing value for --${key}`);
    values[key] = value;
  }
  return values;
}
const args = parseArgs(process.argv.slice(2));
if (!args.tier || !["single", "lite", "full"].includes(args.tier)) fail("--tier single|lite|full is required");
if (!args.models) fail("--models comma-separated-model-ids is required");
if (!args["output-dir"]) fail("--output-dir is required");
const models = [...new Set(args.models.split(",").map((model) => model.trim()).filter(Boolean))];
if (!models.length) fail("--models must include at least one model id");
const genericTurns = Number(args["generic-turns"] ?? "72");
const taskCap = Number(args["max-task-cost-usd"] ?? "9");
const totalCap = Number(args["max-total-cost-usd"] ?? "75");
for (const [name, value, limit] of [["generic-turns", genericTurns, 72], ["max-task-cost-usd", taskCap, Number.POSITIVE_INFINITY], ["max-total-cost-usd", totalCap, Number.POSITIVE_INFINITY]]) if (!Number.isFinite(value) || value <= 0 || value > limit || (name === "generic-turns" && !Number.isInteger(value))) fail(`invalid --${name}`);
const output = resolve(args["output-dir"]);
const tiersPath = resolve(args["tiers-manifest"] ?? "fixtures/own-harness-tasks/tiers.json");
const tiersBytes = readFileSync(tiersPath);
const tiers = JSON.parse(tiersBytes.toString("utf8"));
if (tiers?.schemaVersion !== "pareto-owned-node-tiers/v1") fail("unsupported tier manifest schema");
const fixturePath = resolve(new URL(tiers.fixtureManifest.path, `file://${tiersPath}`).pathname);
const fixtureBytes = readFileSync(fixturePath);
if (sha256(fixtureBytes) !== tiers.fixtureManifest.sha256) fail("fixture manifest sha256 does not match tiers manifest binding");
const fixtures = JSON.parse(fixtureBytes.toString("utf8"));
const allIds = fixtures.tasks.map((task) => task.id);
const selected = tiers.tiers[args.tier]?.taskIds;
if (!Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length) fail(`invalid ${args.tier} task list`);
if (!selected.every((id) => allIds.includes(id))) fail("tier contains a task absent from fixture manifest");
for (const [smaller, larger] of [["single", "lite"], ["lite", "full"]]) {
  const a = tiers.tiers[smaller]?.taskIds, b = tiers.tiers[larger]?.taskIds;
  if (!Array.isArray(a) || !Array.isArray(b) || JSON.stringify(a) !== JSON.stringify(b.slice(0, a.length))) fail("tiers must be ordered nested prefixes");
}
if (args.tier === "full" && (selected.length !== allIds.length || new Set(selected).size !== new Set(allIds).size)) fail("full tier must include every fixture exactly once");
const policies = models.map((model) => ({ id: `fixed:${model}`, model, kind: "fixed" }));
if (args["include-pareto"]) policies.push({ id: "pareto:frozen-nine-rung", kind: "pareto" });
if (!policies.length) fail("no policies selected");
const runManifest = { schemaVersion: "owned-node-suite/v1", createdAt: new Date().toISOString(), scope: { tier: args.tier, taskIds: selected, fixtureManifestSha256: sha256(fixtureBytes), tiersManifestSha256: sha256(tiersBytes) }, policies, genericTurns, taskCostCapUsd: taskCap, totalCostCapUsd: totalCap, node: process.version, dryRun: Boolean(args["dry-run"]) };
if (existsSync(output) && !args.resume) fail(`output exists (use --resume): ${output}`);
mkdirSync(output, { recursive: true });
const manifestFile = `${output}/run-manifest.json`;
if (existsSync(manifestFile) && args.resume) {
  const old = JSON.parse(readFileSync(manifestFile));
  if (JSON.stringify(old.scope) !== JSON.stringify(runManifest.scope) || JSON.stringify(old.policies) !== JSON.stringify(runManifest.policies) || old.genericTurns !== genericTurns || old.taskCostCapUsd !== taskCap || old.totalCostCapUsd !== totalCap) fail("resume manifest does not match requested suite");
} else writeFileSync(manifestFile, JSON.stringify(runManifest, null, 2));
const validation = { valid: true, tier: args.tier, taskCount: selected.length, policies: policies.map((policy) => policy.id), fixtureManifestSha256: sha256(fixtureBytes), tiersManifestSha256: sha256(tiersBytes) };
writeFileSync(`${output}/validation.json`, JSON.stringify(validation, null, 2));
if (args["dry-run"]) { console.log(JSON.stringify({ dryRun: true, ...validation }, null, 2)); process.exit(0); }
if (!process.env.OPENROUTER_API_KEY) fail("OPENROUTER_API_KEY is required for a live run");
let spent = 0;
const rows = [];
function childRoot(taskId, policy) { return `${output}/tasks/${taskId}/${encodeURIComponent(policy.id)}`; }
for (const taskId of selected) for (const policy of policies) {
  const child = childRoot(taskId, policy);
  const resultFile = `${child}/results.json`;
  if (existsSync(resultFile)) {
    const data = JSON.parse(readFileSync(resultFile));
    const result = policy.kind === "pareto" ? data.pareto : data.generic;
    if (!result) fail(`resume result missing ${policy.id} for ${taskId}`);
    rows.push({ taskId, policyId: policy.id, ...result, resumed: true });
    if (result.costAccountingComplete) spent += result.actualCostUsd;
    continue;
  }
  if (spent >= totalCap) { rows.push({ taskId, policyId: policy.id, outcome: "not_dispatched_global_cap", costAccountingComplete: false }); continue; }
  const env = { ...process.env, OWN_HARNESS_MAX_TURNS: String(policy.kind === "fixed" ? genericTurns : 8), OWN_HARNESS_ATTEMPT_CAP_USD: String(taskCap), OWN_HARNESS_GENERIC_MODEL: policy.model ?? "openai/gpt-5.6-luna", OWN_HARNESS_SKIP_PARETO: policy.kind === "fixed" ? "1" : "0", OWN_HARNESS_SKIP_GENERIC: policy.kind === "pareto" ? "1" : "0" };
  const childRun = spawnSync(process.execPath, ["scripts/run-own-comparison.mjs", child, taskId], { stdio: "inherit", env });
  if (childRun.status !== 0 || !existsSync(resultFile)) { rows.push({ taskId, policyId: policy.id, outcome: "runner_error", costAccountingComplete: false, exitCode: childRun.status }); continue; }
  const data = JSON.parse(readFileSync(resultFile));
  const result = policy.kind === "pareto" ? data.pareto : data.generic;
  if (!result) { rows.push({ taskId, policyId: policy.id, outcome: "runner_error", costAccountingComplete: false }); continue; }
  rows.push({ taskId, policyId: policy.id, ...result, resumed: false });
  if (result.costAccountingComplete) spent += result.actualCostUsd;
}
const summaries = Object.fromEntries(policies.map((policy) => {
  const policyRows = rows.filter((row) => row.policyId === policy.id);
  const completeRows = policyRows.filter((row) => row.costAccountingComplete);
  return [policy.id, { taskCount: policyRows.length, resolved: policyRows.filter((row) => row.outcome === "resolved").length, completeCostRows: completeRows.length, actualCostUsd: completeRows.reduce((sum, row) => sum + row.actualCostUsd, 0) }];
}));
const result = { schemaVersion: "owned-node-suite-results/v1", scope: runManifest.scope, policies, genericTurns, taskCostCapUsd: taskCap, totalCostCapUsd: totalCap, observedCompleteCostUsd: spent, rows, summaries };
writeFileSync(`${output}/results.json`, JSON.stringify(result, null, 2));
writeFileSync(`${output}/results.csv`, ["tier_id,task_id,policy_id,outcome,cost_accounting_complete,actual_cost_usd,attempts,resumed", ...rows.map((row) => [args.tier, row.taskId, row.policyId, row.outcome, row.costAccountingComplete, row.actualCostUsd ?? "", row.attempts?.length ?? "", Boolean(row.resumed)].join(","))].join("\n") + "\n");
const summaryRows = policies.map((policy) => { const s = summaries[policy.id]; return `| \`${policy.id}\` | ${s.resolved} / ${s.taskCount} | ${s.completeCostRows} / ${s.taskCount} | $${s.actualCostUsd.toFixed(6)} |`; }).join("\n");
writeFileSync(`${output}/REPORT.md`, `# Owned Node model matrix — tier: \`${args.tier}\` (${selected.length} tasks)\n\n**Scope:** ${selected.map((id) => `\`${id}\``).join(", ")}. Fixed models use one continuous ${genericTurns}-turn session; Pareto retains its immutable nine-rung policy with eight turns per rung. Every row below uses the same fixture baseline, prompt, tools, and regression.\n\n| Policy | Resolved | Complete-cost rows | Actual provider cost |\n|---|---:|---:|---:|\n${summaryRows}\n\n**Observed complete-cost spend:** $${spent.toFixed(6)} (cap: $${totalCap.toFixed(2)}). This is an owned-fixture directional study, not a general benchmark claim.\n`);
console.log(readFileSync(`${output}/REPORT.md`, "utf8"));
