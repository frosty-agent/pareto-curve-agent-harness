import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const BENCHMARK_ARTIFACT_SCHEMA_VERSION = 1;

export type IneligibilityReason =
  | "internal_judge_rejected"
  | "cost_accounting_incomplete"
  | "empty_final_patch"
  | "timeout"
  | "contaminated_workspace"
  | "artifact_incomplete"
  | "patch_hash_mismatch"
  | "provenance_mismatch"
  | "worker_failed";

export interface ArtifactRef {
  relativePath: string;
  sha256: string;
}

export interface InstanceSubmissionInput {
  instanceId: string;
  modelNameOrPath: string;
  baselineCommit: string;
  taskManifestSha256: string;
  ladderSha256: string;
  expectedTaskManifestSha256: string;
  expectedLadderSha256: string;
  scrubSucceeded: boolean;
  workerSucceeded: boolean;
  timedOut: boolean;
  internalJudgeAccepted: boolean;
  costAccountingComplete: boolean;
  finalPatch: string;
  finalPatchSha256: string;
  acceptedPatchSha256: string;
  artifacts: ArtifactRef[];
  requiredArtifactPaths: string[];
}

export interface InstanceSubmissionDecision {
  eligible: boolean;
  reasons: IneligibilityReason[];
}

export interface PersistentInstanceResult {
  schemaVersion: number;
  instanceId: string;
  generatedAt: string;
  input: InstanceSubmissionInput;
  decision: InstanceSubmissionDecision;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * The one canonical gate before a patch can be written to an official SWE-bench
 * predictions file. It is intentionally deterministic; an LLM verdict alone is
 * never enough to make a patch eligible.
 */
export function decideInstanceSubmission(input: InstanceSubmissionInput): InstanceSubmissionDecision {
  const reasons: IneligibilityReason[] = [];
  if (!input.internalJudgeAccepted) reasons.push("internal_judge_rejected");
  if (!input.costAccountingComplete) reasons.push("cost_accounting_incomplete");
  if (!input.finalPatch.trim()) reasons.push("empty_final_patch");
  if (input.timedOut) reasons.push("timeout");
  if (!input.scrubSucceeded) reasons.push("contaminated_workspace");
  if (!input.workerSucceeded) reasons.push("worker_failed");
  if (input.taskManifestSha256 !== input.expectedTaskManifestSha256 || input.ladderSha256 !== input.expectedLadderSha256) reasons.push("provenance_mismatch");
  if (input.finalPatchSha256 !== sha256(input.finalPatch) || input.finalPatchSha256 !== input.acceptedPatchSha256) reasons.push("patch_hash_mismatch");

  const artifactPaths = new Set(input.artifacts.map((artifact) => artifact.relativePath));
  if (input.requiredArtifactPaths.some((path) => !artifactPaths.has(path)) || input.artifacts.some((artifact) => !artifact.relativePath || !/^[a-f0-9]{64}$/i.test(artifact.sha256))) {
    reasons.push("artifact_incomplete");
  }
  return { eligible: reasons.length === 0, reasons };
}

export function createPersistentInstanceResult(input: InstanceSubmissionInput, generatedAt = new Date().toISOString()): PersistentInstanceResult {
  return {
    schemaVersion: BENCHMARK_ARTIFACT_SCHEMA_VERSION,
    instanceId: input.instanceId,
    generatedAt,
    input,
    decision: decideInstanceSubmission(input),
  };
}

export function predictionLine(result: PersistentInstanceResult): string | undefined {
  if (!result.decision.eligible) return undefined;
  return `${JSON.stringify({ instance_id: result.instanceId, model_patch: result.input.finalPatch, model_name_or_path: result.input.modelNameOrPath })}\n`;
}

/** Writes atomically to a caller-owned persistent artifact root, never a container /tmp path. */
export async function writePersistentInstanceResult(rootDirectory: string, result: PersistentInstanceResult): Promise<string> {
  const root = resolve(rootDirectory);
  await mkdir(root, { recursive: true });
  const target = join(root, "pareto-instance-result.json");
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await rename(temporary, target);
  return target;
}
