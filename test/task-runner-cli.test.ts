import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("Bash ladder runner documents Docker, prompt, workspace, and report behavior", async () => {
  const script = await readFile(join(process.cwd(), "scripts/run-ladder.sh"), "utf8");
  assert.match(script, /--help/);
  assert.match(script, /OPENROUTER_API_KEY/);
  assert.match(script, /docker info/);
  assert.match(script, /--prompt/);
  assert.match(script, /--workspace/);
  assert.match(script, /--mount "type=bind,src=.*dst=\/source,readonly/);
  assert.match(script, /dst=\/workspace/);
  assert.match(script, /dst=\/reports/);
  assert.match(script, /PARETO_TASK_PROMPT/);
});
