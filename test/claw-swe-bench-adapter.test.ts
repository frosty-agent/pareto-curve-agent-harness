import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("Claw-SWE-Bench Pareto adapter mounts a runtime and runs the worker in /testbed", async () => {
  const adapter = await readFile(join(process.cwd(), "integrations/claw-swe-bench/pareto.py"), "utf8");

  assert.match(adapter, /class ParetoAdapter\(BaseClawAdapter\):/);
  assert.match(adapter, /name = "pareto"/);
  assert.match(adapter, /PARETO_RUNTIME_DIR/);
  assert.match(adapter, /PARETO_NODE_BIN/);
  assert.match(adapter, /PARETO_WORKSPACE=\/testbed/);
  assert.match(adapter, /\/opt\/pareto\/openrouter-worker\.mjs/);
  assert.match(adapter, /agent_stdout\.log/);
  assert.match(adapter, /agent_stderr\.log/);
});

test("OpenRouter worker can use a benchmark workspace instead of only /workspace", async () => {
  const worker = await readFile(join(process.cwd(), "openrouter-worker.mjs"), "utf8");

  assert.match(worker, /process\.env\.PARETO_WORKSPACE \?\? "\/workspace"/);
  assert.match(worker, /process\.env\.PARETO_MAX_TOOL_ROUNDS \?\? "12"/);
  assert.match(worker, /configuredMaxToolRounds.*> 0 \? configuredMaxToolRounds : 12/);
  assert.match(worker, /tests\\\/runtests\\\.py/);
  assert.match(worker, /git log --oneline -20/);
});
