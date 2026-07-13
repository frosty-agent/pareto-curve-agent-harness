import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLadder,
  expectedCostUsd,
  normalizeCatalog,
  paretoFrontier,
  type OpenRouterModel,
} from "../src/frontier.js";

const model = (overrides: Partial<OpenRouterModel>): OpenRouterModel => ({
  id: "example/model",
  name: "Example",
  pricing: { prompt: "0.000001", completion: "0.000002" },
  architecture: {
    input_modalities: ["text"],
    output_modalities: ["text"],
  },
  supported_parameters: ["tools", "response_format"],
  benchmarks: { artificial_analysis: { coding_index: 50 } },
  ...overrides,
});

test("calculates expected input/output cost from OpenRouter per-token prices", () => {
  assert.equal(expectedCostUsd(model({}), 10_000, 2_000), 0.014);
});

test("filters models without Coding Index and projects modality capability booleans", () => {
  const normalized = normalizeCatalog([
    model({ id: "with-media", architecture: { input_modalities: ["text", "image", "video"], output_modalities: ["text", "image"] } }),
    model({ id: "no-score", benchmarks: {} }),
  ], { inputTokens: 1_000, outputTokens: 1_000 });

  assert.equal(normalized.length, 1);
  assert.deepEqual(normalized[0].capabilities, {
    supportsImageInput: true,
    supportsVideoInput: true,
    supportsImageOutput: true,
    supportsVideoOutput: false,
  });
});

test("excludes models with missing, invalid, or negative token pricing", () => {
  const normalized = normalizeCatalog([
    model({ id: "missing", pricing: { prompt: undefined, completion: "0.000001" } }),
    model({ id: "invalid", pricing: { prompt: "not-a-number", completion: "0.000001" } }),
    model({ id: "negative", pricing: { prompt: "-0.000001", completion: "0.000001" } }),
    model({ id: "priced" }),
  ], { inputTokens: 1_000, outputTokens: 1_000 });

  assert.deepEqual(normalized.map(({ id }) => id), ["priced"]);
});

test("removes models dominated by equal-or-better coding at lower cost", () => {
  const candidates = normalizeCatalog([
    model({ id: "cheap", pricing: { prompt: "0.000001", completion: "0.000001" }, benchmarks: { artificial_analysis: { coding_index: 50 } } }),
    model({ id: "dominated", pricing: { prompt: "0.000003", completion: "0.000003" }, benchmarks: { artificial_analysis: { coding_index: 50 } } }),
    model({ id: "strong", pricing: { prompt: "0.000004", completion: "0.000004" }, benchmarks: { artificial_analysis: { coding_index: 80 } } }),
  ], { inputTokens: 1_000, outputTokens: 1_000 });

  assert.deepEqual(paretoFrontier(candidates).map(({ id }) => id), ["cheap", "strong"]);
});

test("builds a low-to-high ladder and fills a requested limit with marked dominated models", () => {
  const candidates = normalizeCatalog([
    model({ id: "cheap", pricing: { prompt: "0.000001", completion: "0.000001" }, benchmarks: { artificial_analysis: { coding_index: 50 } } }),
    model({ id: "dominated", pricing: { prompt: "0.000003", completion: "0.000003" }, benchmarks: { artificial_analysis: { coding_index: 50 } } }),
    model({ id: "strong", pricing: { prompt: "0.000004", completion: "0.000004" }, benchmarks: { artificial_analysis: { coding_index: 80 } } }),
  ], { inputTokens: 1_000, outputTokens: 1_000 });

  assert.deepEqual(buildLadder(candidates, 3).map(({ id, isParetoOptimal }) => ({ id, isParetoOptimal })), [
    { id: "cheap", isParetoOptimal: true },
    { id: "strong", isParetoOptimal: true },
    { id: "dominated", isParetoOptimal: false },
  ]);
});
