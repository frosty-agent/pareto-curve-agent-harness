import { execFile } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd });
  return result.stdout.trim();
}

export interface OwnRunnerWorkspace {
  workspace: string;
  publicBaseCommit: string;
  syntheticBaselineCommit: string;
  reset(): Promise<void>;
  patch(): Promise<string>;
}

/**
 * Copies a prepared worktree and commits its already-applied public test patch as
 * a local synthetic baseline. Agent diffs/reset operations are then relative to
 * this baseline and can neither leak nor remove public test changes.
 */
export async function createOwnRunnerWorkspace(preparedTestbed: string, target: string, publicBaseCommit: string): Promise<OwnRunnerWorkspace> {
  const workspace = resolve(target);
  await mkdir(dirname(workspace), { recursive: true });
  await rm(workspace, { recursive: true, force: true });
  await cp(resolve(preparedTestbed), workspace, { recursive: true });
  const current = await git(workspace, ["rev-parse", "HEAD"]);
  if (current !== publicBaseCommit) throw new Error(`prepared workspace HEAD ${current} does not match public base ${publicBaseCommit}`);
  const publicPatch = await git(workspace, ["diff", "--binary"]);
  if (!publicPatch.trim()) throw new Error("prepared workspace must contain the applied public test patch");
  await git(workspace, ["config", "user.email", "own-runner@local.invalid"]);
  await git(workspace, ["config", "user.name", "Own Runner"]);
  await git(workspace, ["add", "-A"]);
  await git(workspace, ["commit", "-m", "own-runner public test baseline", "--no-gpg-sign"]);
  const syntheticBaselineCommit = await git(workspace, ["rev-parse", "HEAD"]);
  return {
    workspace, publicBaseCommit, syntheticBaselineCommit,
    async reset() { await git(workspace, ["reset", "--hard", syntheticBaselineCommit]); await git(workspace, ["clean", "-fdx"]); },
    async patch() { return git(workspace, ["diff", "--binary", syntheticBaselineCommit]); },
  };
}
