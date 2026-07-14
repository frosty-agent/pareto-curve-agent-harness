import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { buildLadder, normalizeCatalog } from "./frontier.js";
import { fetchCatalog } from "./cli.js";
import { OpenRouterJudge } from "./openrouter-judge.js";
import { ParetoTaskLadder, type AttemptWorkspace, type CodingTask, type TaskWorker, type WorkerContext, type WorkerResult } from "./task-ladder.js";
import { writeReports } from "./report.js";

const execFile = promisify(execFileCallback);
const source = "/source";
const workspaceDirectory = "/workspace";
const reportsDirectory = "/reports";

const task: CodingTask = { id: "interval-normalizer", prompt: "Implement src/interval.ts exporting immutable normalizeIntervals(input). Validate finite endpoints/end >= start, sort, merge overlap and directly-adjacent integer intervals, add node:test coverage, then run npm test and npm run build." };

class ContainerWorkspace implements AttemptWorkspace {
  private baseline = "";
  async setup() {
    // /workspace is provisioned by the image and owned by the unprivileged runner;
    // clear its contents rather than unlinking the directory from the root-owned parent.
    await mkdir(workspaceDirectory, { recursive: true });
    await Promise.all((await readdir(workspaceDirectory)).map((entry) => rm(join(workspaceDirectory, entry), { recursive: true, force: true })));
    await mkdir(reportsDirectory, { recursive: true });
    await execFile("git", ["clone", "-q", source, workspaceDirectory]);
    this.baseline = (await execFile("git", ["-C", workspaceDirectory, "rev-parse", "HEAD"])).stdout.trim();
    return { sourceCommit: this.baseline, baselineCommit: this.baseline, workingDirectory: workspaceDirectory, artifactsDirectory: reportsDirectory };
  }
  async snapshotAndReset(attemptNumber: number) {
    await execFile("git", ["-C", workspaceDirectory, "add", "-N", "."]);
    const patch = (await execFile("git", ["-C", workspaceDirectory, "diff", "--binary", this.baseline])).stdout;
    const path = `${reportsDirectory}/attempt-${attemptNumber}.patch`;
    await writeFile(path, patch);
    await execFile("git", ["-C", workspaceDirectory, "reset", "--hard", this.baseline]);
    await execFile("git", ["-C", workspaceDirectory, "clean", "-fdx"]);
    return { path, attemptNumber };
  }
  async cleanup() {
    await Promise.all((await readdir(workspaceDirectory)).map((entry) => rm(join(workspaceDirectory, entry), { recursive: true, force: true })));
  }
}

class InContainerOpenRouterWorker implements TaskWorker {
  async run(context: WorkerContext): Promise<WorkerResult> {
    const { stdout } = await execFile("node", ["/app/open-agent-worker.mjs"], { env: { ...process.env, PARETO_TASK_CONTEXT: JSON.stringify(context) }, timeout: 90_000, maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout) as WorkerResult;
  }
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is required");
  const catalog = await fetchCatalog();
  const availableModels = buildLadder(normalizeCatalog(catalog, { inputTokens: 12_000, outputTokens: 4_000, excludePreview: true }), 10);
  const ladder = availableModels.map(({ id, codingIndex, intelligenceIndex }) => ({ id, codingIndex, intelligenceIndex }));
  const result = await new ParetoTaskLadder(new InContainerOpenRouterWorker(), new OpenRouterJudge(), new ContainerWorkspace()).run(task, ladder);
  const report = { generatedAt: new Date().toISOString(), kind: "containerized-openrouter-pareto-task-run", task, availableModels, invokedModels: result.attempts.map((a) => ({ attemptNumber: a.attemptNumber, model: a.model, workerStatus: a.workerResult?.status ?? "not-invoked", usage: a.workerResult?.usage, success: a.judgeResult?.successful ?? false, error: a.error })), result };
  await writeReports(report, reportsDirectory);
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
