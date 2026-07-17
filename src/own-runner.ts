import { execFile } from "node:child_process";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { FROZEN_PARETO_LADDER_IDS } from "./benchmark-manifest.js";
import type { DockerTestRuntime } from "./docker-test-runtime.js";
import type { ToolCall, ToolExecutionResult } from "./openrouter-agent-runner.js";

const execFileAsync = promisify(execFile);

export const FIXED_BASELINE_MODEL = "openai/gpt-5.6-luna" as const;
export type OwnRunnerSystem = "pareto" | "fixed-openai-gpt-5.6-luna";

export interface OwnRunnerTaskRecord {
  instance_id: string;
  base_commit: string;
  problem_statement: string;
  test_patch: string;
  FAIL_TO_PASS: string;
  PASS_TO_PASS?: string;
}

export interface CommandSpec { command: string; argv: string[]; }
export interface OwnRunnerTools {
  schema: unknown[];
  execute(call: ToolCall, signal: AbortSignal): Promise<ToolExecutionResult>;
  regression: CommandSpec;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a nonempty string`);
  return value;
}

/** Select and validate a public record without loading dataset libraries at runtime. */
export function parsePreparedTask(raw: unknown, taskId: string): OwnRunnerTaskRecord {
  const records = Array.isArray(raw) ? raw : typeof raw === "object" && raw !== null && Array.isArray((raw as { instances?: unknown }).instances) ? (raw as { instances: unknown[] }).instances : null;
  if (!records) throw new Error("task export must be an array or {instances: array}");
  const record = records.find((item) => typeof item === "object" && item !== null && (item as { instance_id?: unknown }).instance_id === taskId) as Record<string, unknown> | undefined;
  if (!record) throw new Error(`task ${taskId} is absent from export`);
  return {
    instance_id: requireText(record.instance_id, "instance_id"),
    base_commit: requireText(record.base_commit, "base_commit"),
    problem_statement: requireText(record.problem_statement, "problem_statement"),
    test_patch: requireText(record.test_patch, "test_patch"),
    FAIL_TO_PASS: requireText(record.FAIL_TO_PASS, "FAIL_TO_PASS"),
    ...(typeof record.PASS_TO_PASS === "string" ? { PASS_TO_PASS: record.PASS_TO_PASS } : {}),
  };
}

function parseSelectors(value: string): string[] {
  let selectors: unknown;
  try { selectors = JSON.parse(value); } catch { throw new Error("FAIL_TO_PASS must be a JSON string array"); }
  if (!Array.isArray(selectors) || !selectors.length || selectors.some((selector) => typeof selector !== "string" || !selector.trim())) throw new Error("FAIL_TO_PASS must contain test selectors");
  return selectors as string[];
}

const TESTBED_PYTHON = "/opt/miniconda3/envs/testbed/bin/python";
const TESTBED_PYTEST = "/opt/miniconda3/envs/testbed/bin/pytest";

/** Converts the public task's FAIL_TO_PASS metadata to an exact no-shell argv. */
export function derivePublicRegressionCommand(record: OwnRunnerTaskRecord): CommandSpec {
  const selectors = parseSelectors(record.FAIL_TO_PASS);
  if (record.instance_id.startsWith("django__django-")) {
    const labels = selectors.map((selector) => {
      const match = /^(.*?) \(([^()]+)\)$/.exec(selector);
      if (!match) throw new Error(`unsupported Django selector: ${selector}`);
      return `${match[2]}.${match[1]}`;
    });
    return { command: `${TESTBED_PYTHON} tests/runtests.py ${labels.join(" ")}`, argv: [TESTBED_PYTHON, "tests/runtests.py", ...labels] };
  }
  if (record.instance_id.startsWith("sphinx-doc__sphinx-")) return { command: `${TESTBED_PYTHON} -m pytest ${selectors.join(" ")}`, argv: [TESTBED_PYTHON, "-m", "pytest", ...selectors] };
  if (record.instance_id.startsWith("pallets__flask-") || record.instance_id.startsWith("psf__requests-")) return { command: `${TESTBED_PYTEST} -rA ${selectors.join(" ")}`, argv: [TESTBED_PYTEST, "-rA", ...selectors] };
  throw new Error(`no deterministic regression command mapping for ${record.instance_id}`);
}

function safePath(workspace: string, requested: string): string {
  const root = resolve(workspace);
  const target = resolve(root, requested);
  if (relative(root, target).startsWith("..")) throw new Error("path escapes workspace");
  return target;
}

function bounded(text: string, limit = 32_000): string { return text.length <= limit ? text : `${text.slice(0, limit)}\n[output truncated]`; }

function sameRegression(left: CommandSpec, right: DockerTestRuntime["regression"]): boolean {
  return left.command === right.command && left.argv.length === right.argv.length && left.argv.every((arg, index) => arg === right.argv[index]);
}

/** Creates the identical four-tool contract used by both own-runner policies. */
export function createOwnRunnerTools(workspace: string, regression: CommandSpec, maxToolExecutions = 36, testRuntime?: DockerTestRuntime): OwnRunnerTools {
  const allowed = new Map<string, CommandSpec>([
    [regression.command, regression],
  ]);
  let remaining = maxToolExecutions;
  const schema = [
    { type: "function", function: { name: "read_file", description: "Read a UTF-8 file below /testbed.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
    { type: "function", function: { name: "list_files", description: "List paths below /testbed.", parameters: { type: "object", properties: { path: { type: "string" } } } } },
    { type: "function", function: { name: "apply_patch", description: "Apply a unified diff without modifying public test files.", parameters: { type: "object", properties: { diff: { type: "string" } }, required: ["diff"] } } },
    { type: "function", function: { name: "run_command", description: `Run only: ${[...allowed.keys()].join("; ")}.`, parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
  ];
  return {
    schema,
    regression,
    async execute(call, signal) {
      if (--remaining < 0) return { content: "Tool execution budget exhausted", isError: true };
      let args: Record<string, unknown>;
      try { args = JSON.parse(call.function.arguments) as Record<string, unknown>; } catch { return { content: "Invalid tool JSON", isError: true }; }
      try {
        if (call.function.name === "read_file") return { content: bounded(await readFile(safePath(workspace, requireText(args.path, "path")), "utf8")) };
        if (call.function.name === "list_files") return { content: (await readdir(safePath(workspace, typeof args.path === "string" ? args.path : "."), { recursive: true })).slice(0, 300).join("\n") };
        if (call.function.name === "apply_patch") {
          const diff = requireText(args.diff, "diff");
          if (/^diff --git a\/(?:tests\/|test\/)/m.test(diff)) return { content: "Public test files cannot be modified", isError: true };
          const patchPath = join(workspace, ".own-runner-apply.patch");
          await writeFile(patchPath, diff, "utf8");
          try { await execFileAsync("git", ["apply", "--whitespace=nowarn", patchPath], { cwd: workspace, signal, timeout: 120_000 }); }
          finally { await rm(patchPath, { force: true }); }
          return { content: "patch applied" };
        }
        if (call.function.name === "run_command") {
          const command = requireText(args.command, "command"); const spec = allowed.get(command);
          if (!spec) return { content: "Command is not allowlisted", isError: true };
          if (!testRuntime) return { content: "Docker test runtime is required", isError: true };
          if (!sameRegression(regression, testRuntime.regression)) return { content: "Docker test runtime does not match allowed regression", isError: true };
          const result = await testRuntime.run(signal);
          if (result.timedOut) return { content: "Command timed out", isError: true };
          return result.exitCode === 0 ? { content: result.output } : { content: result.output || "command failed", isError: true };
        }
        return { content: `Unknown tool ${call.function.name}`, isError: true };
      } catch (error) { return { content: error instanceof Error ? error.message : String(error), isError: true }; }
    },
  };
}

export function modelsForSystem(system: OwnRunnerSystem): readonly string[] { return system === "pareto" ? FROZEN_PARETO_LADDER_IDS : [FIXED_BASELINE_MODEL]; }
