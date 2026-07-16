import assert from "node:assert/strict";
import test from "node:test";

import { FROZEN_PARETO_LADDER_IDS, parseFrozenManifest } from "../src/benchmark-manifest.js";

const digest = (letter: string) => letter.repeat(64);
function fixture(): unknown {
  return {
    schemaVersion: "pareto-benchmark-manifest/v2", experimentId: "verified-mini-5", createdAt: "2026-07-16T00:00:00.000Z",
    dataset: { name: "princeton-nlp/SWE-bench_Verified", revision: "c104f840cc67f8b6eec6f759ebc8b2693d585d4a", split: "test", taskIds: ["django__django-11790"] },
    systems: [
      { id: "pareto", policy: "frozen-nine-rung", judgeModel: "x-ai/grok-4.5", ladder: FROZEN_PARETO_LADDER_IDS.map((id) => ({ id, provider: id.split("/")[0] })) },
      { id: "fixed-openai-gpt-5.6-luna", policy: "fixed-model", model: "openai/gpt-5.6-luna", judgeModel: "openai/gpt-5.6-luna" },
    ],
    caps: { perTaskUsd: 9, perSystemUsd: 45, globalUsd: 100 }, artifacts: { catalogSha256: digest("a"), taskListSha256: digest("b") },
  };
}

test("accepts the exact frozen nine-rung experiment contract", () => {
  const manifest = parseFrozenManifest(fixture());
  assert.deepEqual(manifest.systems[0].ladder.map((model) => model.id), FROZEN_PARETO_LADDER_IDS);
  assert.equal(manifest.caps.globalUsd, 100);
});

test("rejects a reordered, shortened, or substituted Pareto ladder", () => {
  const reordered = fixture() as { systems: Array<{ ladder?: unknown[] }> };
  [reordered.systems[0].ladder![0], reordered.systems[0].ladder![1]] = [reordered.systems[0].ladder![1], reordered.systems[0].ladder![0]];
  assert.throws(() => parseFrozenManifest(reordered), /frozen ordering/);
  const shortened = fixture() as { systems: Array<{ ladder?: unknown[] }> };
  shortened.systems[0].ladder!.pop();
  assert.throws(() => parseFrozenManifest(shortened), /exactly nine/);
});

test("rejects mutable caps and duplicate tasks", () => {
  const mutableCaps = fixture() as { caps: { perTaskUsd: number } };
  mutableCaps.caps.perTaskUsd = 8;
  assert.throws(() => parseFrozenManifest(mutableCaps), /perTaskUsd/);
  const duplicateTasks = fixture() as { dataset: { taskIds: string[] } };
  duplicateTasks.dataset.taskIds.push("django__django-11790");
  assert.throws(() => parseFrozenManifest(duplicateTasks), /unique/);
});
