import { resolve } from "node:path";

import { createPersistentInstanceResult, predictionLine, writePersistentInstanceResult, type InstanceSubmissionInput } from "./benchmark-artifacts.js";

export interface BenchmarkArtifactsCliOutput {
  resultPath: string;
  result: ReturnType<typeof createPersistentInstanceResult>;
  prediction: Record<string, string> | null;
}

export async function processBenchmarkArtifactsInput(rootDirectory: string, input: InstanceSubmissionInput): Promise<BenchmarkArtifactsCliOutput> {
  const result = createPersistentInstanceResult(input);
  const resultPath = await writePersistentInstanceResult(rootDirectory, result);
  const line = predictionLine(result);
  return { resultPath, result, prediction: line ? JSON.parse(line) as Record<string, string> : null };
}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const rootIndex = process.argv.indexOf("--root");
  if (rootIndex < 0 || !process.argv[rootIndex + 1]) throw new Error("Usage: benchmark-artifacts-cli --root <persistent-artifact-directory>");
  const raw = await readStandardInput();
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("stdin must contain one InstanceSubmissionInput JSON object");
  const output = await processBenchmarkArtifactsInput(resolve(process.argv[rootIndex + 1]!), parsed as InstanceSubmissionInput);
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (process.argv[1]?.endsWith("benchmark-artifacts-cli.ts") || process.argv[1]?.endsWith("benchmark-artifacts-cli.js")) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
