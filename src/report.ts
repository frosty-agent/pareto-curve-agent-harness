import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ReportPaths { json: string; html: string }

/** Stable event contract for AGE-10 agent execution traces. */
export const REPORT_SCHEMA_VERSION = "pareto-report/v2" as const;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type SessionStatus = "running" | "succeeded" | "failed" | "cancelled";
export type EventStatus = "started" | "succeeded" | "failed" | "skipped";

export interface EventBase {
  /** Unique within a report; sortable in emission order. */
  eventId: string;
  sequence: number;
  /** RFC 3339 timestamp with offset (normally UTC ISO-8601). */
  timestamp: string;
  /** Correlates a tool result to its tool call, or a hook result to its start. */
  parentEventId?: string;
  attemptNumber?: number;
}
export interface AgentMessageEvent extends EventBase {
  type: "agent.message";
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}
export interface ToolEvent extends EventBase {
  type: "tool.call" | "tool.result";
  toolCallId: string;
  toolName: string;
  status: EventStatus;
  input?: JsonValue;
  output?: JsonValue;
  error?: { name: string; message: string; code?: string };
  durationMs?: number;
}
export interface HookEvent extends EventBase {
  type: "hook.started" | "hook.completed";
  hookId: string;
  hookName: string;
  phase: "pre" | "post" | "error";
  status: EventStatus;
  input?: JsonValue;
  output?: JsonValue;
  error?: { name: string; message: string; code?: string };
  durationMs?: number;
}
export interface McpEvent extends EventBase {
  type: "mcp.server_connected" | "mcp.server_disconnected" | "mcp.tool_call" | "mcp.tool_result";
  serverId: string;
  serverName: string;
  transport?: "stdio" | "sse" | "streamable-http" | "in-memory" | string;
  toolCallId?: string;
  toolName?: string;
  status: EventStatus;
  input?: JsonValue;
  output?: JsonValue;
  error?: { name: string; message: string; code?: string };
  durationMs?: number;
}
export type AgentReportEvent = AgentMessageEvent | ToolEvent | HookEvent | McpEvent;

export interface AgentSessionReport {
  sessionId: string;
  agent: { id: string; name?: string; version?: string };
  startedAt: string;
  endedAt?: string;
  status: SessionStatus;
  /** Events MUST be ordered by ascending sequence. Payloads must be secret-redacted before writing. */
  events: AgentReportEvent[];
}
export interface TraceReport {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  agentSessions: AgentSessionReport[];
}

const secretKeyPattern = /(?:api[_-]?key|authorization|token|password|secret|cookie)/i;
const tokenAccountingKeyPattern = /^(?:input|output|total)[_-]?tokens?$/i;
const bearerPattern = /\b(?:Bearer\s+|sk-(?:or|ant|proj)-)[A-Za-z0-9._-]+/gi;

/** Return a JSON-safe copy that cannot persist common credential fields or tokens. */
export function redactReportSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactReportSecrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      secretKeyPattern.test(key) && !tokenAccountingKeyPattern.test(key) ? "[REDACTED]" : redactReportSecrets(entry),
    ]));
  }
  return typeof value === "string" ? value.replace(bearerPattern, "[REDACTED]") : value;
}

export async function writeReports(report: unknown, outputDirectory: string): Promise<ReportPaths> {
  const redacted = redactReportSecrets(report);
  await mkdir(outputDirectory, { recursive: true });
  const json = join(outputDirectory, "report.json");
  const html = join(outputDirectory, "report.html");
  await writeFile(json, `${JSON.stringify(redacted, null, 2)}\n`, "utf8");
  await writeFile(html, renderHtml(redacted), "utf8");
  return { json, html };
}

function escape(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
function stringify(value: unknown): string { return value === undefined ? "" : JSON.stringify(value, null, 2); }
function eventLabel(event: AgentReportEvent): string {
  if (event.type.startsWith("tool.")) return `${event.type}: ${(event as ToolEvent).toolName}`;
  if (event.type.startsWith("hook.")) return `${event.type}: ${(event as HookEvent).hookName}`;
  if (event.type.startsWith("mcp.")) { const mcp = event as McpEvent; return `${event.type}: ${mcp.serverName}${mcp.toolName ? ` / ${mcp.toolName}` : ""}`; }
  return `${event.type}: ${(event as AgentMessageEvent).role}`;
}
function eventDetails(event: AgentReportEvent): string {
  const details: Record<string, unknown> = { eventId: event.eventId, sequence: event.sequence, parentEventId: event.parentEventId, timestamp: event.timestamp, attemptNumber: event.attemptNumber };
  for (const key of ["toolCallId", "toolName", "hookId", "hookName", "phase", "serverId", "serverName", "transport", "role", "content", "input", "output", "error", "durationMs"] as const) {
    if (key in event) details[key] = (event as unknown as Record<string, unknown>)[key];
  }
  return stringify(details);
}
function renderSessions(sessions: AgentSessionReport[]): string {
  if (!sessions.length) return "";
  return `<h2>Agent sessions</h2>${sessions.map((session) => `<section class="session"><h3><code>${escape(session.agent.id)}</code>${session.agent.name ? ` — ${escape(session.agent.name)}` : ""}</h3><p class="meta">Session <code>${escape(session.sessionId)}</code> · ${escape(session.status)} · ${escape(session.startedAt)}${session.endedAt ? ` → ${escape(session.endedAt)}` : ""}</p><ol class="events">${session.events.map((event) => `<li><details><summary><code>${escape(event.sequence)}</code> ${escape(eventLabel(event))} <b class="${escape("status-" + ("status" in event ? event.status : "succeeded"))}">${escape("status" in event ? event.status : "")}</b></summary><pre>${escape(eventDetails(event))}</pre></details></li>`).join("")}</ol></section>`).join("")}`;
}

export function renderHtml(report: unknown): string {
  const data = report as { generatedAt?: string; task?: { id?: string; prompt?: string }; models?: Array<Record<string, unknown>>; availableModels?: Array<Record<string, unknown>>; invokedModels?: Array<Record<string, unknown>>; totalCostUsd?: number | null; costModel?: Record<string, unknown>; policy?: Record<string, unknown>; trace?: TraceReport };
  const models = data.models ?? data.availableModels ?? [];
  const rows = models.map((model, index) => `<tr><td>${index + 1}</td><td><code>${escape(model.id)}</code></td><td>${escape(model.provider)}</td><td>${escape(model.codingIndex)}</td><td>${escape(model.intelligenceIndex)}</td><td>${model.isParetoOptimal === undefined ? "" : model.isParetoOptimal ? "yes" : "no"}</td></tr>`).join("\n");
  const history = (data.invokedModels ?? []).map((attempt) => { const usage = attempt.usage as { inputTokens?: number; outputTokens?: number; costUsd?: number } | undefined; return `<tr><td>${escape(attempt.attemptNumber)}</td><td>${escape(attempt.invocationRole ?? "worker")}</td><td><code>${escape((attempt.model as { id?: string })?.id)}</code></td><td>${escape(attempt.workerStatus)}</td><td>${escape(attempt.success)}</td><td>${escape(usage?.inputTokens ?? "—")}</td><td>${escape(usage?.outputTokens ?? "—")}</td><td>${usage?.costUsd === undefined ? "—" : `$${Number(usage.costUsd).toFixed(6)}`}</td><td>${escape(attempt.error ?? "")}</td></tr>`; }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pareto Curve Report</title><style>body{font:15px system-ui,sans-serif;max-width:1100px;margin:24px auto;padding:0 16px;color:#172033;background:#fbfcff}code{font-size:12px;overflow-wrap:anywhere}.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -16px;padding:0 16px}table{border-collapse:collapse;width:100%;min-width:720px;background:#fff}th,td{padding:10px;border:1px solid #dce3ee;text-align:left;vertical-align:top}th{background:#172033;color:#fff;white-space:nowrap}tr:nth-child(even){background:#f4f7fb}.meta{color:#526174}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef3f9;padding:12px;border-radius:8px}.session{background:#fff;border:1px solid #dce3ee;border-radius:8px;padding:12px;margin:12px 0}.session h3{margin:0}.events{padding-left:22px}.events li{margin:8px 0}summary{cursor:pointer;overflow-wrap:anywhere}.status-failed{color:#b42318}.status-succeeded{color:#067647}@media(max-width:640px){body{font-size:14px;margin:16px auto}h1{font-size:24px}h2{font-size:18px}th,td{padding:8px}.events{padding-left:18px}.session{padding:10px}pre{padding:10px}}</style></head><body><h1>Pareto Curve Report</h1><h2>Models selected for this run</h2><div class="scroll"><table><thead><tr><th>Rung</th><th>Model</th><th>Provider</th><th>Coding index</th><th>Intelligence index</th><th>Pareto optimal</th></tr></thead><tbody>${rows}</tbody></table></div>${data.task ? `<h2>Task: ${escape(data.task.id)}</h2><pre>${escape(data.task.prompt)}</pre><h2>Invocation history</h2><div class="scroll"><table><thead><tr><th>Attempt</th><th>Role</th><th>Model</th><th>Worker</th><th>Judge accepted</th><th>Input tokens</th><th>Output tokens</th><th>Actual cost</th><th>Error</th></tr></thead><tbody>${history}</tbody></table></div><p class="meta">Total actual cost: ${data.totalCostUsd === undefined || data.totalCostUsd === null ? "unavailable" : `$${Number(data.totalCostUsd).toFixed(6)}`}</p>` : ""}${renderSessions(data.trace?.agentSessions ?? [])}<p class="meta">Generated: ${escape(data.generatedAt)}</p><p class="meta">Policy: ${escape(JSON.stringify(data.policy))}</p></body></html>`;
}
