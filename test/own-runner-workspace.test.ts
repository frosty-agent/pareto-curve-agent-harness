import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { createOwnRunnerWorkspace } from "../src/own-runner-workspace.js";

const exec = promisify(execFile);
async function git(cwd: string, ...args: string[]) { return (await exec("git", args, { cwd })).stdout.trim(); }

test("makes a synthetic baseline containing the public test patch and resets agent changes to it", async () => {
  const root = await mkdtemp(join(tmpdir(), "own-runner-workspace-"));
  const prepared = join(root, "prepared"); await mkdir(join(prepared, "tests"), { recursive: true });
  await git(root, "init", "prepared");
  await git(prepared, "config", "user.email", "test@example.invalid"); await git(prepared, "config", "user.name", "Test");
  await writeFile(join(prepared, "app.txt"), "base\n"); await writeFile(join(prepared, "tests", "public.txt"), "base test\n");
  await git(prepared, "add", "-A"); await git(prepared, "commit", "-m", "base");
  const base = await git(prepared, "rev-parse", "HEAD");
  await writeFile(join(prepared, "tests", "public.txt"), "public test patch\n");
  const state = await createOwnRunnerWorkspace(prepared, join(root, "run", "workspace"), base);
  assert.notEqual(state.syntheticBaselineCommit, base);
  await writeFile(join(state.workspace, "app.txt"), "agent repair\n");
  assert.match(await state.patch(), /agent repair/);
  assert.doesNotMatch(await state.patch(), /public test patch/);
  await state.reset();
  assert.equal(await readFile(join(state.workspace, "app.txt"), "utf8"), "base\n");
  assert.equal(await readFile(join(state.workspace, "tests", "public.txt"), "utf8"), "public test patch\n");
});
