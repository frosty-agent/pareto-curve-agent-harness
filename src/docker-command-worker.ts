import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import type { TaskWorker, WorkerContext, WorkerResult } from "./task-ladder.js";

const execFile = promisify(execFileCallback);

export interface DockerCommandWorkerOptions {
  image: string;
  command: string[];
  environment?: Record<string, string>;
  dockerBinary?: string;
  dockerUser?: string;
  network?: "none" | "bridge";
}

/** Runs each coding attempt inside Docker, mounting only the isolated task workspace. */
export class DockerCommandWorker implements TaskWorker {
  private readonly dockerBinary: string;
  private readonly dockerUser: string;
  private readonly network: "none" | "bridge";

  constructor(private readonly options: DockerCommandWorkerOptions) {
    if (options.command.length === 0) throw new Error("DockerCommandWorker requires a command");
    this.dockerBinary = options.dockerBinary ?? "docker";
    this.dockerUser = options.dockerUser ?? `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
    this.network = options.network ?? "none";
  }

  async run(context: WorkerContext): Promise<WorkerResult> {
    const taskJson = JSON.stringify({ task: context.task, model: context.model, previousAttempt: context.previousAttempt });
    const args = [
      "run", "--rm", "--user", this.dockerUser,
      "--network", this.network,
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--pids-limit", "256",
      "--read-only", "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=64m",
      "--mount", `type=bind,src=${context.workspace.workingDirectory},dst=/workspace`,
    ];
    if (context.workspace.artifactsDirectory) args.push("--mount", `type=bind,src=${context.workspace.artifactsDirectory},dst=/artifacts,readonly`);
    for (const [name, value] of Object.entries(this.options.environment ?? {})) args.push("-e", `${name}=${value}`);
    args.push("-e", `PARETO_TASK_CONTEXT=${taskJson}`, "-w", "/workspace", this.options.image, ...this.options.command);

    const { stdout } = await execFile(this.dockerBinary, args, { maxBuffer: 10 * 1024 * 1024 });
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error("Docker worker must write one JSON WorkerResult object to stdout");
    }
    if (!isWorkerResult(parsed)) throw new Error("Docker worker returned an invalid WorkerResult");
    return parsed;
  }
}

function isWorkerResult(value: unknown): value is WorkerResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WorkerResult>;
  return (candidate.status === "completed" || candidate.status === "failed") && typeof candidate.output === "string";
}
