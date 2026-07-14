import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { Agent } from "/opt/open-agent-sdk/dist/index.js";

const workspace = "/workspace";
const maxTurns = 12;

function safePath(path) {
  const target = resolve(workspace, path);
  if (relative(workspace, target).startsWith("..")) throw new Error("Path escapes workspace");
  return target;
}

function result(content, isError = false) {
  return { type: "tool_result", tool_use_id: "", content, ...(isError ? { is_error: true } : {}) };
}

const workspaceTools = [
  {
    name: "read_file",
    description: "Read a UTF-8 file below /workspace.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    isReadOnly: () => true,
    async call(input) { return result(readFileSync(safePath(input.path), "utf8")); },
  },
  {
    name: "list_files",
    description: "List files below /workspace.",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
    isReadOnly: () => true,
    async call(input) { return result(readdirSync(safePath(input.path ?? "."), { recursive: true }).slice(0, 300).join("\n")); },
  },
  {
    name: "write_file",
    description: "Create or replace a UTF-8 file below /workspace.",
    inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
    async call(input) { writeFileSync(safePath(input.path), input.content, "utf8"); return result("written"); },
  },
  {
    name: "run_check",
    description: "Run exactly one allowed validation command: npm test, npm run build, git diff, or git status --short.",
    inputSchema: { type: "object", properties: { command: { type: "string", enum: ["npm test", "npm run build", "git diff", "git status --short"] } }, required: ["command"] },
    async call(input) {
      const allowed = { "npm test": ["npm", ["test"]], "npm run build": ["npm", ["run", "build"]], "git diff": ["git", ["diff"]], "git status --short": ["git", ["status", "--short"]] };
      const [bin, argv] = allowed[input.command] ?? [];
      if (!bin) return result("Command is not allowlisted", true);
      try { return result(execFileSync(bin, argv, { cwd: workspace, encoding: "utf8", timeout: 120000 })); }
      catch (error) { return result(`${error.stdout ?? ""}\n${error.stderr ?? error.message}`, true); }
    },
  },
];

try {
  const context = JSON.parse(process.env.PARETO_TASK_CONTEXT ?? "");
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing");
  const agent = new Agent({
    apiType: "openrouter",
    apiKey,
    model: context.model.id,
    cwd: workspace,
    tools: workspaceTools,
    maxTurns,
    permissionMode: "bypassPermissions",
    systemPrompt: "You are a coding agent working only through the supplied tools. Inspect the repository, edit files, and run checks. When the task is complete, reply with a concise final summary.",
  });
  const response = await agent.prompt(`${context.task.prompt}\nPrevious attempt: ${JSON.stringify(context.previousAttempt ?? null)}`);
  process.stdout.write(JSON.stringify({
    status: "completed",
    output: response.text || "completed",
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({ status: "failed", output: error instanceof Error ? error.message : String(error) }));
}
