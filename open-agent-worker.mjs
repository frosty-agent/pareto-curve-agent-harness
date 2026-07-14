import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { Agent } from "/opt/open-agent-sdk/dist/index.js";

const workspace = "/workspace";
const maxTurns = 12;
const startedAt = new Date().toISOString();
const events = [];
let sequence = 0;

function emit(event) {
  events.push({ eventId: `worker-${++sequence}`, sequence, timestamp: new Date().toISOString(), ...event });
  return `worker-${sequence}`;
}
function trace() { return { startedAt, endedAt: new Date().toISOString(), events }; }
function safePath(path) {
  const target = resolve(workspace, path);
  if (relative(workspace, target).startsWith("..")) throw new Error("Path escapes workspace");
  return target;
}
function result(content, isError = false) {
  return { type: "tool_result", tool_use_id: "", content, ...(isError ? { is_error: true } : {}) };
}
function instrumentTool(name, inputSchema, call, isReadOnly = false) {
  return {
    name,
    description: `${name.replaceAll("_", " ")} below /workspace.`,
    inputSchema,
    ...(isReadOnly ? { isReadOnly: () => true } : {}),
    async call(input) {
      const hookId = `hook-${sequence + 1}`;
      emit({ type: "hook.started", hookId, hookName: "workspace-tool-audit", phase: "pre", status: "started", input: { toolName: name } });
      const toolCallId = `tool-${sequence + 1}`;
      const callEventId = emit({ type: "tool.call", toolCallId, toolName: name, status: "started", input });
      const toolStartedAt = Date.now();
      try {
        const output = await call(input);
        const status = output.is_error ? "failed" : "succeeded";
        emit({ type: "tool.result", parentEventId: callEventId, toolCallId, toolName: name, status, output: { content: output.content }, durationMs: Date.now() - toolStartedAt });
        emit({ type: "hook.completed", hookId, hookName: "workspace-tool-audit", phase: "post", status, output: { toolName: name }, durationMs: Date.now() - toolStartedAt });
        return output;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const errorRecord = { name: error instanceof Error ? error.name : "Error", message };
        emit({ type: "tool.result", parentEventId: callEventId, toolCallId, toolName: name, status: "failed", output: { content: message }, error: errorRecord, durationMs: Date.now() - toolStartedAt });
        emit({ type: "hook.completed", hookId, hookName: "workspace-tool-audit", phase: "error", status: "failed", error: errorRecord, durationMs: Date.now() - toolStartedAt });
        return result(message, true);
      }
    },
  };
}

const workspaceTools = [
  instrumentTool("read_file", { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, (input) => result(readFileSync(safePath(input.path), "utf8")), true),
  instrumentTool("list_files", { type: "object", properties: { path: { type: "string" } } }, (input) => result(readdirSync(safePath(input.path ?? "."), { recursive: true }).slice(0, 300).join("\n")), true),
  instrumentTool("write_file", { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] }, (input) => { writeFileSync(safePath(input.path), input.content, "utf8"); return result("written"); }),
  instrumentTool("bash", { type: "object", properties: { command: { type: "string" } }, required: ["command"] }, (input) => {
    try { return result(execFileSync("sh", ["-lc", input.command], { cwd: workspace, encoding: "utf8", timeout: 120000, maxBuffer: 10 * 1024 * 1024 })); }
    catch (error) { return result(`${error.stdout ?? ""}\n${error.stderr ?? error.message}`, true); }
  }),
];

try {
  const context = JSON.parse(process.env.PARETO_TASK_CONTEXT ?? "");
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing");
  const abortController = new AbortController();
  const cancel = () => abortController.abort();
  process.once("SIGTERM", cancel);
  process.once("SIGINT", cancel);
  const agent = new Agent({
    apiType: "openrouter", apiKey, model: context.model.id, cwd: workspace, tools: workspaceTools,
    maxTurns, permissionMode: "bypassPermissions", abortController,
    systemPrompt: "You are a coding agent working only through the supplied tools. Inspect the repository, edit files, and run checks. When the task is complete, reply with a concise final summary.",
  });
  emit({ type: "agent.message", role: "user", content: context.task.prompt });
  let output = "completed";
  let usage;
  let costUsd;
  for await (const event of agent.query(`${context.task.prompt}\nPrevious attempt: ${JSON.stringify(context.previousAttempt ?? null)}`)) {
    if (event.type === "assistant") output = event.message.content.filter((block) => block.type === "text").map((block) => block.text).join("") || output;
    if (event.type === "result") { usage = event.usage; costUsd = event.total_cost_usd; }
  }
  process.off("SIGTERM", cancel);
  process.off("SIGINT", cancel);
  emit({ type: "agent.message", role: "assistant", content: output });
  process.stdout.write(JSON.stringify({ status: "completed", output, usage: { inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens, ...(costUsd === undefined ? {} : { costUsd }) }, trace: trace() }));
} catch (error) {
  process.stdout.write(JSON.stringify({ status: "failed", output: error instanceof Error ? error.message : String(error), trace: trace() }));
}
