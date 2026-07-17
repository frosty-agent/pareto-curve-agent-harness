import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPersistentInstanceResult, decideInstanceSubmission, predictionLine, sha256, writePersistentInstanceResult, type InstanceSubmissionInput } from "../src/benchmark-artifacts.js";
import { processBenchmarkArtifactsInput } from "../src/benchmark-artifacts-cli.js";

function validInput(): InstanceSubmissionInput {
  const finalPatch = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@\n-old\n+new\n";
  return {
    instanceId: "repo__task-1", modelNameOrPath: "pareto/recorded-ladder", baselineCommit: "abc123",
    taskManifestSha256: "a".repeat(64), expectedTaskManifestSha256: "a".repeat(64),
    ladderSha256: "b".repeat(64), expectedLadderSha256: "b".repeat(64),
    scrubSucceeded: true, workerSucceeded: true, timedOut: false, internalJudgeAccepted: true, costAccountingComplete: true,
    authoritativeActualCostUsd: 0.37,
    finalPatch, finalPatchSha256: sha256(finalPatch), acceptedPatchSha256: sha256(finalPatch),
    artifacts: [
      { relativePath: "attempts/attempt-1-worker-result.json", sha256: "c".repeat(64) },
      { relativePath: "final.patch", sha256: "d".repeat(64) },
    ],
    requiredArtifactPaths: ["attempts/attempt-1-worker-result.json", "final.patch"],
  };
}

test("only an accepted, complete, clean, hash-bound result can produce a prediction", () => {
  const result = createPersistentInstanceResult(validInput(), "2026-01-01T00:00:00.000Z");
  assert.equal(result.decision.eligible, true);
  assert.match(predictionLine(result) ?? "", /repo__task-1/);
});

test("rejects incomplete accounting even if an internal judge accepted a patch", () => {
  const input = validInput();
  input.costAccountingComplete = false;
  const decision = decideInstanceSubmission(input);
  assert.equal(decision.eligible, false);
  assert.deepEqual(decision.reasons, ["cost_accounting_incomplete"]);
});

test("requires a finite provider-reported aggregate cost", () => {
  const input = validInput();
  input.authoritativeActualCostUsd = Number.NaN;
  assert.deepEqual(decideInstanceSubmission(input), { eligible: false, reasons: ["cost_accounting_incomplete"] });
});

test("rejects every disqualifying benchmark state and never emits a prediction", () => {
  const input = validInput();
  input.internalJudgeAccepted = false;
  input.scrubSucceeded = false;
  input.workerSucceeded = false;
  input.timedOut = true;
  input.finalPatchSha256 = "0".repeat(64);
  input.requiredArtifactPaths.push("missing.json");
  const result = createPersistentInstanceResult(input);
  assert.equal(result.decision.eligible, false);
  assert.equal(predictionLine(result), undefined);
  assert.deepEqual(result.decision.reasons, [
    "internal_judge_rejected", "timeout", "contaminated_workspace", "worker_failed", "patch_hash_mismatch", "artifact_incomplete",
  ]);
});

test("writes a durable versioned result atomically under the caller-owned root", async () => {
  const root = await mkdtemp(join(tmpdir(), "pareto-artifact-test-"));
  const result = createPersistentInstanceResult(validInput(), "2026-01-01T00:00:00.000Z");
  const path = await writePersistentInstanceResult(root, result);
  assert.equal(path, join(root, "pareto-instance-result.json"));
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), result);
});

test("canonical gate bridge persists both accepted and rejected decisions but returns a prediction only for accepted input", async () => {
  const root = await mkdtemp(join(tmpdir(), "pareto-gate-cli-test-"));
  const accepted = await processBenchmarkArtifactsInput(join(root, "accepted"), validInput());
  assert.equal(accepted.result.decision.eligible, true);
  assert.equal(accepted.prediction?.instance_id, "repo__task-1");

  const rejectedInput = validInput();
  rejectedInput.internalJudgeAccepted = false;
  const rejected = await processBenchmarkArtifactsInput(join(root, "rejected"), rejectedInput);
  assert.equal(rejected.result.decision.eligible, false);
  assert.equal(rejected.prediction, null);
  assert.equal(JSON.parse(await readFile(rejected.resultPath, "utf8")).decision.reasons[0], "internal_judge_rejected");
});
