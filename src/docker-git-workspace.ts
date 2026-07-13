import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import type { AttemptWorkspace, ChangeSnapshot, WorkspaceInfo } from "./task-ladder.js";

const execFile = promisify(execFileCallback);

export interface DockerGitWorkspaceOptions {
  sourceDirectory: string;
  image?: string;
  dockerBinary?: string;
  dockerUser?: string;
  temporaryRoot?: string;
}

export class DockerGitWorkspace implements AttemptWorkspace {
  private readonly sourceDirectory: string;
  private readonly image: string;
  private readonly dockerBinary: string;
  private readonly dockerUser: string;
  private readonly temporaryRoot: string;
  private root?: string;
  private sandboxDirectory?: string;
  private artifactsDirectory?: string;
  private workspace?: WorkspaceInfo;

  constructor(options: DockerGitWorkspaceOptions) {
    this.sourceDirectory = resolve(options.sourceDirectory);
    this.image = options.image ?? "pareto-task-sandbox:latest";
    this.dockerBinary = options.dockerBinary ?? "docker";
    this.dockerUser = options.dockerUser ?? `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
    this.temporaryRoot = options.temporaryRoot ?? tmpdir();
  }

  async setup(): Promise<WorkspaceInfo> {
    if (this.workspace) return this.workspace;
    const { stdout: sourceStdout } = await execFile("git", ["-C", this.sourceDirectory, "rev-parse", "HEAD"]);
    const sourceCommit = sourceStdout.trim();
    if (!/^[0-9a-f]{40}$/i.test(sourceCommit)) throw new Error("Source directory does not have a valid git HEAD commit");

    this.root = await mkdtemp(join(this.temporaryRoot, "pareto-task-ladder-"));
    this.sandboxDirectory = join(this.root, "workspace");
    this.artifactsDirectory = join(this.root, "artifacts");
    await mkdir(this.sandboxDirectory, { mode: 0o700 });
    await mkdir(this.artifactsDirectory, { mode: 0o700 });
    try {
      const { stdout } = await this.runDocker([
        "run", "--rm", "--user", this.dockerUser,
        "--mount", `type=bind,src=${this.sourceDirectory},dst=/source,readonly`,
        "--mount", `type=bind,src=${this.sandboxDirectory},dst=/workspace`,
        "-e", `SOURCE_COMMIT=${sourceCommit}`,
        this.image,
        "sh", "-euc",
        "git -c safe.directory=/source/.git clone -q /source /workspace && cd /workspace && git -c safe.directory=/workspace checkout -q \"$SOURCE_COMMIT\" && git -c safe.directory=/workspace config user.name pareto-sandbox && git -c safe.directory=/workspace config user.email pareto-sandbox@local && git -c safe.directory=/workspace rev-parse HEAD",
      ]);
      const baselineCommit = stdout.trim();
      if (!/^[0-9a-f]{40}$/i.test(baselineCommit)) throw new Error("Docker sandbox did not return a valid baseline commit");
      this.workspace = {
        sourceCommit,
        baselineCommit,
        workingDirectory: this.sandboxDirectory!,
        artifactsDirectory: this.artifactsDirectory!,
      };
      return this.workspace;
    } catch (error) {
      await this.cleanup();
      throw error;
    }
  }

  async snapshotAndReset(attemptNumber: number): Promise<ChangeSnapshot> {
    if (!this.root || !this.sandboxDirectory || !this.artifactsDirectory || !this.workspace) throw new Error("Docker git workspace has not been initialized");
    const patchPath = join(this.artifactsDirectory, `attempt-${attemptNumber}.patch`);
    const { stdout: patch } = await this.runDocker([
      "run", "--rm", "--user", this.dockerUser,
      "--mount", `type=bind,src=${this.sandboxDirectory},dst=/workspace`,
      "-e", `BASELINE_COMMIT=${this.workspace.baselineCommit}`,
      this.image,
      "sh", "-euc",
      "cd /workspace && git -c safe.directory=/workspace add -N . && git -c safe.directory=/workspace diff --binary \"$BASELINE_COMMIT\"",
    ]);
    await writeFile(patchPath, patch, "utf8");
    await this.runDocker([
      "run", "--rm", "--user", this.dockerUser,
      "--mount", `type=bind,src=${this.sandboxDirectory},dst=/workspace`,
      "-e", `BASELINE_COMMIT=${this.workspace.baselineCommit}`,
      this.image,
      "sh", "-euc",
      "cd /workspace && git -c safe.directory=/workspace reset --hard \"$BASELINE_COMMIT\" && git -c safe.directory=/workspace clean -fdx",
    ]);
    return { path: patchPath, attemptNumber };
  }

  async cleanup(): Promise<void> {
    if (this.root) await rm(this.root, { recursive: true, force: true });
    this.root = undefined;
    this.sandboxDirectory = undefined;
    this.artifactsDirectory = undefined;
    this.workspace = undefined;
  }

  private async runDocker(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFile(this.dockerBinary, args, { maxBuffer: 10 * 1024 * 1024 });
  }
}
