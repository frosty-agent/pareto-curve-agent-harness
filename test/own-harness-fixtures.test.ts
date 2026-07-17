import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const validator = fileURLToPath(new URL("../fixtures/own-harness-tasks/validate-fixtures.mjs", import.meta.url));

test("owned Node fixture manifest is hash-bound and its broken baselines fail", async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [validator]);
  assert.match(stdout, /validated 3 intentionally failing fixture baselines/);
  assert.equal(stderr, "");
});
