import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import type { CommandSpec } from "./own-runner.js";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_LIMIT = 32_000;

export interface DockerCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  signal?: NodeJS.Signals | null;
}

export interface DockerCommandOptions {
  signal: AbortSignal;
  timeoutMs: number;
  maxBuffer: number;
}

/** Injectable boundary for Docker; production invokes `docker` with this argv. */
export type DockerCommandExecutor = (argv: readonly string[], options: DockerCommandOptions) => Promise<DockerCommandResult>;

export interface DockerTestRuntimeOptions {
  workspace: string;
  imageId: string;
  regression: CommandSpec;
  timeoutMs?: number;
  outputLimit?: number;
  executor?: DockerCommandExecutor;
}

export interface DockerTestResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  signal?: NodeJS.Signals | null;
}

export interface DockerTestRuntime {
  readonly regression: { readonly command: string; readonly argv: readonly string[] };
  run(signal: AbortSignal): Promise<DockerTestResult>;
}

function bounded(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n[output truncated]`;
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

function validateImageId(imageId: string): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error("imageId must be an immutable image ID (sha256:<64 lowercase hex characters>)");
  return imageId;
}

function mountSource(workspace: string): string {
  const source = resolve(workspace);
  if (/[\0,\n\r]/.test(source)) throw new Error("workspace cannot be encoded safely as a Docker mount source");
  return source;
}

const defaultDockerExecutor: DockerCommandExecutor = async (argv, options) => {
  try {
    const result = await execFileAsync("docker", [...argv], {
      signal: options.signal,
      timeout: options.timeoutMs,
      maxBuffer: options.maxBuffer,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error: unknown) {
    const failure = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
      signal?: NodeJS.Signals | null;
      name?: string;
    };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : null,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      timedOut: failure.killed === true || failure.name === "AbortError",
      ...(failure.signal ? { signal: failure.signal } : {}),
    };
  }
};

/**
 * Runs exactly one public regression argv in a local, immutable SWE-bench image.
 * Repository inspection and edits intentionally stay on the host-owned workspace.
 */
export function createDockerTestRuntime(options: DockerTestRuntimeOptions): DockerTestRuntime {
  const imageId = validateImageId(options.imageId);
  const source = mountSource(options.workspace);
  const timeoutMs = requirePositiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs");
  const outputLimit = requirePositiveInteger(options.outputLimit ?? DEFAULT_OUTPUT_LIMIT, "outputLimit");
  if (!options.regression.argv.length || !options.regression.argv[0]) throw new Error("regression argv must be nonempty");
  const regression = Object.freeze({ command: options.regression.command, argv: Object.freeze([...options.regression.argv]) });
  const executor = options.executor ?? defaultDockerExecutor;
  const argv = [
    "run", "--rm", "--network", "none",
    "--mount", `type=bind,src=${source},dst=/testbed`,
    "--workdir", "/testbed",
    imageId,
    ...options.regression.argv,
  ];

  return {
    regression,
    async run(signal) {
      const result = await executor(argv, { signal, timeoutMs, maxBuffer: outputLimit });
      return {
        exitCode: result.exitCode,
        output: bounded(`${result.stdout}\n${result.stderr}`, outputLimit),
        timedOut: result.timedOut === true,
        ...(result.signal ? { signal: result.signal } : {}),
      };
    },
  };
}
