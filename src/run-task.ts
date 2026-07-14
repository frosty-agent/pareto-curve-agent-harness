import { execFile as execFileCallback } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { DockerCommandWorker } from "./docker-command-worker.js";
import { DockerGitWorkspace } from "./docker-git-workspace.js";
import { buildLadder, normalizeCatalog } from "./frontier.js";
import { fetchCatalog } from "./cli.js";
import { OpenRouterJudge } from "./openrouter-judge.js";
import { ParetoTaskLadder, type CodingTask, type LadderModel } from "./task-ladder.js";
import { writeReports } from "./report.js";

const execFile = promisify(execFileCallback);

const task: CodingTask = {
  id: "interval-normalizer",
  prompt: `Implement a production-quality interval normalizer in this TypeScript repository.

Create src/interval.ts exporting type Interval = readonly [number, number] and function normalizeIntervals(input: readonly Interval[]): Interval[]. It must: reject non-finite values or end < start with a descriptive Error; never mutate input; sort intervals; merge overlapping AND directly-adjacent integer intervals (for example [1,2] + [3,5] becomes [1,5]); preserve non-adjacent gaps; return new tuple values. Add thorough node:test coverage in test/interval.test.ts for unsorted input, overlap, adjacency, gap, immutability, and invalid values. Run npm test and npm run build. Return a unified git diff only, with no markdown fences or explanation.`,
};

async function main(): Promise<void> {
  const outputDirectory = resolve(process.argv[2] ?? "reports/task-run");
  const sourceDirectory = resolve(process.cwd());
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is required to run the coding task");
  await mkdir(outputDirectory, { recursive: true });
  await execFile("docker", ["build", "-f", "Dockerfile.openrouter-worker", "-t", "pareto-openrouter-worker:latest", "."], { cwd: sourceDirectory });

  const catalog = await fetchCatalog();
  const candidates = normalizeCatalog(catalog, { inputTokens: 12_000, outputTokens: 4_000, excludePreview: true });
  const availableModels = buildLadder(candidates, 10);
  const ladder: LadderModel[] = availableModels.map(({ id, codingIndex, intelligenceIndex }) => ({ id, codingIndex, intelligenceIndex }));
  const workspace = new DockerGitWorkspace({ sourceDirectory });
  const worker = new DockerCommandWorker({
    image: "pareto-openrouter-worker:latest",
    command: ["node", "/opt/openrouter-worker.mjs"],
    environment: { OPENROUTER_API_KEY: key },
    network: "bridge",
  });
  const result = await new ParetoTaskLadder(worker, new OpenRouterJudge(key), workspace).run(task, ladder);
  const report = {
    generatedAt: new Date().toISOString(),
    kind: "openrouter-pareto-task-run",
    task,
    availableModels,
    invokedModels: result.attempts.map((attempt) => ({
      attemptNumber: attempt.attemptNumber,
      model: attempt.model,
      workerStatus: attempt.workerResult?.status ?? "not-invoked",
      usage: attempt.workerResult?.usage,
      workerOutput: attempt.workerResult?.output ?? "",
      judge: attempt.judgeResult,
      success: attempt.judgeResult?.successful ?? false,
      error: attempt.error,
      patch: attempt.changeSnapshot?.path,
    })),
    result,
  };
  const paths = await writeReports(report, outputDirectory);
  console.log(JSON.stringify({ ...report, reportPaths: paths }, null, 2));
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
