export const FROZEN_MANIFEST_SCHEMA_VERSION = "pareto-benchmark-manifest/v2" as const;
export const FROZEN_PARETO_LADDER_IDS = [
  "deepseek/deepseek-v4-flash",
  "xiaomi/mimo-v2.5",
  "nex-agi/nex-n2-pro",
  "kwaipilot/kat-coder-pro-v2",
  "xiaomi/mimo-v2.5-pro",
  "moonshotai/kimi-k2.6",
  "z-ai/glm-5.2",
  "openai/gpt-5.6-luna",
  "x-ai/grok-4.5",
] as const;

export type Sha256 = string;
export interface FrozenLadderModel { id: string; provider: string; }
export interface FrozenManifestV2 {
  schemaVersion: typeof FROZEN_MANIFEST_SCHEMA_VERSION;
  experimentId: string;
  createdAt: string;
  dataset: { name: "princeton-nlp/SWE-bench_Verified"; revision: string; split: "test"; taskIds: string[] };
  systems: [
    { id: "pareto"; policy: "frozen-nine-rung"; ladder: FrozenLadderModel[]; judgeModel: string },
    { id: "fixed-openai-gpt-5.6-luna"; policy: "fixed-model"; model: "openai/gpt-5.6-luna"; judgeModel: string },
  ];
  caps: { perTaskUsd: 9; perSystemUsd: 45; globalUsd: 100 };
  artifacts: { catalogSha256: Sha256; taskListSha256: Sha256 };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a nonempty string`);
  return value;
}
function sha(value: unknown, label: string): Sha256 {
  const result = text(value, label);
  if (!/^[a-f0-9]{64}$/i.test(result)) throw new Error(`${label} must be a SHA-256 hex digest`);
  return result;
}
function exactNumber(value: unknown, expected: number, label: string): number {
  if (value !== expected) throw new Error(`${label} must equal ${expected}`);
  return expected;
}

/** Validates the immutable experiment contract; it never derives/reorders a ladder from live catalog data. */
export function parseFrozenManifest(value: unknown): FrozenManifestV2 {
  const root = object(value, "manifest");
  if (root.schemaVersion !== FROZEN_MANIFEST_SCHEMA_VERSION) throw new Error("unsupported manifest schemaVersion");
  const createdAt = text(root.createdAt, "createdAt");
  if (Number.isNaN(Date.parse(createdAt))) throw new Error("createdAt must be RFC3339-compatible");
  const dataset = object(root.dataset, "dataset");
  if (dataset.name !== "princeton-nlp/SWE-bench_Verified" || dataset.split !== "test") throw new Error("dataset must pin SWE-bench Verified test split");
  const taskIds = dataset.taskIds;
  if (!Array.isArray(taskIds) || taskIds.length === 0 || taskIds.some((id) => typeof id !== "string" || !id) || new Set(taskIds).size !== taskIds.length) throw new Error("dataset.taskIds must be unique nonempty strings");

  const systems = root.systems;
  if (!Array.isArray(systems) || systems.length !== 2) throw new Error("systems must contain Pareto then fixed GPT-5.6 Luna");
  const pareto = object(systems[0], "systems[0]");
  const fixed = object(systems[1], "systems[1]");
  if (pareto.id !== "pareto" || pareto.policy !== "frozen-nine-rung") throw new Error("systems[0] must be frozen Pareto");
  if (fixed.id !== "fixed-openai-gpt-5.6-luna" || fixed.policy !== "fixed-model" || fixed.model !== "openai/gpt-5.6-luna") throw new Error("systems[1] must be fixed GPT-5.6 Luna");
  const rawLadder = pareto.ladder;
  if (!Array.isArray(rawLadder) || rawLadder.length !== FROZEN_PARETO_LADDER_IDS.length) throw new Error("Pareto ladder must contain exactly nine recorded models");
  const ladder = rawLadder.map((entry, index) => {
    const model = object(entry, `ladder[${index}]`);
    const id = text(model.id, `ladder[${index}].id`);
    if (id !== FROZEN_PARETO_LADDER_IDS[index]) throw new Error(`ladder[${index}] does not match the frozen ordering`);
    return { id, provider: text(model.provider, `ladder[${index}].provider`) };
  });
  const caps = object(root.caps, "caps");
  const artifacts = object(root.artifacts, "artifacts");
  return {
    schemaVersion: FROZEN_MANIFEST_SCHEMA_VERSION,
    experimentId: text(root.experimentId, "experimentId"), createdAt,
    dataset: { name: "princeton-nlp/SWE-bench_Verified", revision: text(dataset.revision, "dataset.revision"), split: "test", taskIds: [...taskIds] as string[] },
    systems: [
      { id: "pareto", policy: "frozen-nine-rung", ladder, judgeModel: text(pareto.judgeModel, "pareto.judgeModel") },
      { id: "fixed-openai-gpt-5.6-luna", policy: "fixed-model", model: "openai/gpt-5.6-luna", judgeModel: text(fixed.judgeModel, "fixed.judgeModel") },
    ],
    caps: { perTaskUsd: exactNumber(caps.perTaskUsd, 9, "caps.perTaskUsd") as 9, perSystemUsd: exactNumber(caps.perSystemUsd, 45, "caps.perSystemUsd") as 45, globalUsd: exactNumber(caps.globalUsd, 100, "caps.globalUsd") as 100 },
    artifacts: { catalogSha256: sha(artifacts.catalogSha256, "artifacts.catalogSha256"), taskListSha256: sha(artifacts.taskListSha256, "artifacts.taskListSha256") },
  };
}
