import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs } from "../src/cli.js";

test("rejects a requested ladder longer than ten models", () => {
  assert.throws(() => parseArgs(["--limit", "11"]), /must be between 1 and 10/);
});

test("parses token mix, frontier limit, and policy flags", () => {
  assert.deepEqual(parseArgs([
    "--input-tokens", "12000",
    "--output-tokens", "3000",
    "--limit", "10",
    "--exclude-preview",
    "--allow-provider", "openai,anthropic",
    "--require-tools",
  ]), {
    inputTokens: 12000,
    outputTokens: 3000,
    limit: 10,
    excludePreview: true,
    allowedProviders: new Set(["openai", "anthropic"]),
    requireTools: true,
  });
});
