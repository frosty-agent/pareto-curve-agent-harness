import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ReportPaths { json: string; html: string }

export async function writeReports(report: unknown, outputDirectory: string): Promise<ReportPaths> {
  await mkdir(outputDirectory, { recursive: true });
  const json = join(outputDirectory, "report.json");
  const html = join(outputDirectory, "report.html");
  await writeFile(json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(html, renderHtml(report), "utf8");
  return { json, html };
}

function escape(value: unknown): string {
  return String(value ?? "").replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
}

export function renderHtml(report: unknown): string {
  const data = report as { generatedAt?: string; task?: { id?: string; prompt?: string }; models?: Array<Record<string, unknown>>; availableModels?: Array<Record<string, unknown>>; invokedModels?: Array<Record<string, unknown>>; costModel?: Record<string, unknown>; policy?: Record<string, unknown> };
  const models = data.models ?? data.availableModels ?? [];
  const rows = models.map((model, index) => `<tr><td>${index + 1}</td><td><code>${escape(model.id)}</code></td><td>${escape(model.provider)}</td><td>${escape(model.codingIndex)}</td><td>${escape(model.intelligenceIndex)}</td><td>${model.isParetoOptimal === undefined ? "" : model.isParetoOptimal ? "yes" : "no"}</td></tr>`).join("\n");
  const history = (data.invokedModels ?? []).map((attempt) => { const usage = attempt.usage as { inputTokens?: number; outputTokens?: number; costUsd?: number } | undefined; return `<tr><td>${escape(attempt.attemptNumber)}</td><td><code>${escape((attempt.model as { id?: string })?.id)}</code></td><td>${escape(attempt.workerStatus)}</td><td>${escape(attempt.success)}</td><td>${escape(usage?.inputTokens ?? "—")}</td><td>${escape(usage?.outputTokens ?? "—")}</td><td>${usage?.costUsd === undefined ? "—" : `$${Number(usage.costUsd).toFixed(6)}`}</td><td>${escape(attempt.error ?? "")}</td></tr>`; }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pareto Curve Report</title><style>body{font:15px system-ui,sans-serif;max-width:1100px;margin:24px auto;padding:0 16px;color:#172033;background:#fbfcff}code{font-size:12px;overflow-wrap:anywhere}.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -16px;padding:0 16px}table{border-collapse:collapse;width:100%;min-width:720px;background:#fff}th,td{padding:10px;border:1px solid #dce3ee;text-align:left;vertical-align:top}th{background:#172033;color:#fff;white-space:nowrap}tr:nth-child(even){background:#f4f7fb}.meta{color:#526174}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef3f9;padding:12px;border-radius:8px}@media(max-width:640px){body{font-size:14px;margin:16px auto}h1{font-size:24px}h2{font-size:18px}th,td{padding:8px}}</style></head><body><h1>Pareto Curve Report</h1><h2>Models selected for this run</h2><div class="scroll"><table><thead><tr><th>Rung</th><th>Model</th><th>Provider</th><th>Coding index</th><th>Intelligence index</th><th>Pareto optimal</th></tr></thead><tbody>${rows}</tbody></table></div>${data.task ? `<h2>Task: ${escape(data.task.id)}</h2><pre>${escape(data.task.prompt)}</pre><h2>Invocation history</h2><div class="scroll"><table><thead><tr><th>Attempt</th><th>Model</th><th>Worker</th><th>Judge accepted</th><th>Input tokens</th><th>Output tokens</th><th>Actual cost</th><th>Error</th></tr></thead><tbody>${history}</tbody></table></div>` : ""}<p class="meta">Generated: ${escape(data.generatedAt)}</p><p class="meta">Policy: ${escape(JSON.stringify(data.policy))}</p></body></html>`;
}
