import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { OpenRouter } from "@openrouter/sdk";

const workspace = process.env.PARETO_WORKSPACE ?? "/workspace";
const workerPath = "/opt/pareto/openrouter-worker.mjs";
const artifactRoot = "/tmp/pareto-ladder";
const apiKey = process.env.OPENROUTER_API_KEY;
const taskContext = JSON.parse(process.env.PARETO_TASK_CONTEXT ?? "{}");
const ladder = JSON.parse(process.env.PARETO_LADDER_JSON ?? "[]");
const judgeModel = process.env.PARETO_JUDGE_MODEL;
const capUsd = Number(process.env.PARETO_TASK_COST_CAP_USD);

function fail(message) {
  process.stdout.write(JSON.stringify({ status: "failed", output: message }));
  process.exitCode = 1;
}
function git(args) { return execFileSync("git", ["-C", workspace, ...args], { encoding: "utf8" }); }
function finiteCost(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null; }
function save(name, value) { mkdirSync(artifactRoot, { recursive: true }); writeFileSync(`${artifactRoot}/${name}`, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`); }
function runWorker(context) {
  const result = spawnSync(process.execPath, [workerPath], {
    encoding: "utf8",
    env: { ...process.env, PARETO_TASK_CONTEXT: JSON.stringify(context) },
  });
  let payload = {};
  if (result.error) {
    payload = { status: "failed", output: `Worker process failed: ${result.error.message}` };
  } else {
    try { payload = JSON.parse(result.stdout || "{}"); }
    catch { payload = { status: "failed", output: "Worker emitted invalid JSON" }; }
  }
  return { exitCode: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "", payload };
}
async function judge(client, context, worker, patch) {
  const response = await client.chat.send({
    chatRequest: {
      model: judgeModel,
      temperature: 0,
      responseFormat: { type: "json_object" },
      messages: [
        { role: "system", content: "You decide whether a coding-agent patch is ready for independent benchmark evaluation. Return only JSON: {successful:boolean, learnings:string}. Be conservative; do not claim tests passed without evidence." },
        { role: "user", content: JSON.stringify({ task: context.task, model: context.model, worker: worker.payload, patch }) },
      ],
    },
  });
  const text = response.choices?.[0]?.message?.content?.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!text) throw new Error("Judge returned no content");
  const verdict = JSON.parse(text);
  if (typeof verdict.successful !== "boolean" || typeof verdict.learnings !== "string") throw new Error("Judge returned invalid JSON schema");
  const costUsd = finiteCost(response.usage?.cost);
  return { ...verdict, usage: { inputTokens: response.usage?.promptTokens, outputTokens: response.usage?.completionTokens, ...(costUsd === null ? {} : { costUsd }) } };
}

if (!apiKey) fail("OPENROUTER_API_KEY is required");
else if (!Array.isArray(ladder) || !ladder.length || !ladder.every((model) => typeof model?.id === "string")) fail("PARETO_LADDER_JSON must contain model IDs");
else if (!judgeModel) fail("PARETO_JUDGE_MODEL is required for a dynamic ladder");
else if (!Number.isFinite(capUsd) || capUsd < 0) fail("PARETO_TASK_COST_CAP_USD must be a finite non-negative number");
else {
  const baseline = git(["rev-parse", "HEAD"]).trim();
  const client = new OpenRouter({ apiKey, appTitle: "Pareto Curve Agent Harness" });
  const attempts = [];
  let spent = 0;
  let accountingComplete = true;
  let previousAttempt = null;
  let finalWorker = null;
  let finalOutput = "Ladder exhausted";
  let accepted = false;
  for (let index = 0; index < ladder.length; index += 1) {
    const model = ladder[index];
    const estimate = finiteCost(model.expectedCostUsd);
    if (estimate === null || spent + estimate > capUsd) { finalOutput = "Cost cap prevents next rung"; break; }
    const context = { ...taskContext, attemptNumber: index + 1, model, previousAttempt, task: { ...taskContext.task, costCapUsd: capUsd, costSpentUsd: spent } };
    const worker = runWorker(context);
    save(`attempt-${index + 1}-worker-stdout.log`, worker.stdout);
    save(`attempt-${index + 1}-worker-stderr.log`, worker.stderr);
    save(`attempt-${index + 1}-worker-result.json`, worker.payload);
    const workerCost = finiteCost(worker.payload?.usage?.costUsd);
    if (worker.payload?.usage?.costAccountingComplete !== true || workerCost === null) { accountingComplete = false; finalWorker = worker.payload; finalOutput = "Worker cost unavailable"; attempts.push({ attemptNumber: index + 1, model, worker: worker.payload, stop: "cost_unavailable" }); break; }
    spent += workerCost;
    const patch = git(["diff", "--binary", baseline]);
    save(`attempt-${index + 1}.patch`, patch);
    let verdict;
    try { verdict = await judge(client, context, worker, patch); }
    catch (error) { finalWorker = worker.payload; finalOutput = error instanceof Error ? error.message : String(error); attempts.push({ attemptNumber: index + 1, model, worker: worker.payload, stop: "judge_error" }); break; }
    save(`attempt-${index + 1}-judge-result.json`, verdict);
    const judgeCost = finiteCost(verdict.usage?.costUsd);
    if (judgeCost === null) { accountingComplete = false; finalWorker = worker.payload; finalOutput = "Judge cost unavailable"; attempts.push({ attemptNumber: index + 1, model, worker: worker.payload, judge: verdict, stop: "cost_unavailable" }); break; }
    spent += judgeCost;
    const attempt = { attemptNumber: index + 1, model, worker: worker.payload, judge: verdict, patchPath: `attempt-${index + 1}.patch` };
    attempts.push(attempt);
    finalWorker = worker.payload;
    finalOutput = worker.payload?.output ?? finalOutput;
    if (verdict.successful) { accepted = true; break; }
    previousAttempt = { model, workerResult: worker.payload, judgeResult: verdict, changeSnapshot: { path: attempt.patchPath, attemptNumber: index + 1 } };
    if (index + 1 < ladder.length) {
      git(["reset", "--hard", baseline]);
      git(["clean", "-fdx"]);
      if (git(["rev-parse", "HEAD"]).trim() !== baseline || git(["status", "--porcelain"]).trim()) throw new Error("Failed to reset workspace before next rung");
    }
  }
  const result = { status: accepted ? "completed" : "failed", output: finalOutput, usage: { costUsd: spent, costAccountingComplete: accountingComplete }, ladder: { baseline, accepted, attempts, costCapUsd: capUsd } };
  save("pareto-ladder-result.json", result);
  process.stdout.write(JSON.stringify(result));
}
