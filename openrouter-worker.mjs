import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { OpenRouter } from "@openrouter/sdk";

const workspace = process.env.PARETO_WORKSPACE ?? "/workspace";
const maxToolRounds = 12;
const tools = [
  { type: "function", function: { name: "read_file", description: "Read a UTF-8 file below /workspace.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "list_files", description: "List files below /workspace.", parameters: { type: "object", properties: { path: { type: "string" } } } } },
  { type: "function", function: { name: "write_file", description: "Create or replace a UTF-8 file below /workspace.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function", function: { name: "run_check", description: "Run exactly one allowed validation command: npm test, npm run build, git diff, or git status --short.", parameters: { type: "object", properties: { command: { type: "string", enum: ["npm test", "npm run build", "git diff", "git status --short"] } }, required: ["command"] } } },
];
function safePath(path) { const target = resolve(workspace, path); if (relative(workspace, target).startsWith("..")) throw new Error("Path escapes workspace"); return target; }
function toolResult(name, args) {
  if (name === "read_file") return readFileSync(safePath(args.path), "utf8");
  if (name === "list_files") return readdirSync(safePath(args.path ?? "."), { recursive: true }).slice(0, 300).join("\n");
  if (name === "write_file") { writeFileSync(safePath(args.path), args.content, "utf8"); return "written"; }
  if (name === "run_check") { const allowed = { "npm test": ["npm", ["test"]], "npm run build": ["npm", ["run", "build"]], "git diff": ["git", ["diff"]], "git status --short": ["git", ["status", "--short"]] }; const [bin, argv] = allowed[args.command] ?? []; if (!bin) throw new Error("Command is not allowlisted"); try { return execFileSync(bin, argv, { cwd: workspace, encoding: "utf8", timeout: 120000 }); } catch (error) { return `${error.stdout ?? ""}\n${error.stderr ?? error.message}`; } }
  throw new Error(`Unknown tool ${name}`);
}
function usageOf(result) { const u = result.usage ?? {}; return { inputTokens: u.promptTokens ?? u.prompt_tokens ?? 0, outputTokens: u.completionTokens ?? u.completion_tokens ?? 0, costUsd: u.cost ?? 0 }; }
const startedAt = new Date().toISOString();
const events = [];
let sequence = 0;
function emit(event) { events.push({ eventId: `worker-${++sequence}`, sequence, timestamp: new Date().toISOString(), ...event }); }
function trace() { return { startedAt, endedAt: new Date().toISOString(), events }; }
try {
  const context = JSON.parse(process.env.PARETO_TASK_CONTEXT ?? "");
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing");
  const client = new OpenRouter({ apiKey, appTitle: "Pareto Curve Agent Harness" });
  const messages = [{ role: "system", content: "You are a coding agent working only through tools. Inspect the repository, edit files, and run checks. When the task is complete, reply with a concise final summary. Never use shell commands outside run_check." }, { role: "user", content: `${context.task.prompt}\nPrevious attempt: ${JSON.stringify(context.previousAttempt ?? null)}` }];
  emit({ type: "agent.message", role: "user", content: messages[1].content });
  let inputTokens = 0, outputTokens = 0, costUsd = 0, final = "Tool budget exhausted";
  for (let round = 0; round < maxToolRounds; round += 1) {
    const result = await client.chat.send({ chatRequest: { model: context.model.id, temperature: 0, messages, tools, toolChoice: "auto" } });
    const usage = usageOf(result); inputTokens += usage.inputTokens; outputTokens += usage.outputTokens; costUsd += usage.costUsd;
    const message = result.choices?.[0]?.message;
    if (!message) throw new Error("OpenRouter returned no assistant message");
    messages.push(message);
    emit({ type: "agent.message", role: "assistant", content: String(message.content ?? "") });
    if (!message.toolCalls?.length) { final = String(message.content ?? "completed"); break; }
    for (const call of message.toolCalls) {
      const eventId = `worker-${sequence + 1}`;
      let args;
      try { args = JSON.parse(call.function.arguments); } catch { args = { rawArguments: call.function.arguments }; }
      emit({ type: "tool.call", toolCallId: call.id, toolName: call.function.name, status: "started", input: args });
      const toolStartedAt = Date.now();
      let output; let error;
      try { output = toolResult(call.function.name, args); } catch (caught) { error = caught instanceof Error ? caught : new Error(String(caught)); output = `Tool error: ${error.message}`; }
      emit({ type: "tool.result", parentEventId: eventId, toolCallId: call.id, toolName: call.function.name, status: error ? "failed" : "succeeded", output: { content: output }, ...(error ? { error: { name: error.name, message: error.message } } : {}), durationMs: Date.now() - toolStartedAt });
      messages.push({ role: "tool", toolCallId: call.id, content: output });
    }
  }
  process.stdout.write(JSON.stringify({ status: "completed", output: final, usage: { inputTokens, outputTokens, costUsd }, trace: trace() }));
} catch (error) { process.stdout.write(JSON.stringify({ status: "failed", output: error instanceof Error ? error.message : String(error), trace: trace() })); }
