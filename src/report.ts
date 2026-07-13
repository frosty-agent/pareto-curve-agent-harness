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
  const data = report as { generatedAt?: string; models?: Array<Record<string, unknown>>; costModel?: Record<string, unknown>; policy?: Record<string, unknown> };
  const rows = (data.models ?? []).map((model, index) => `<tr><td>${index + 1}</td><td><code>${escape(model.id)}</code></td><td>${escape(model.provider)}</td><td>${escape(model.codingIndex)}</td><td>${escape(model.intelligenceIndex)}</td><td>$${Number(model.expectedCostUsd ?? 0).toFixed(6)}</td><td>${model.isParetoOptimal ? "yes" : "no"}</td></tr>`).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pareto Curve Report</title><style>body{font:15px system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 20px;color:#172033;background:#fbfcff}code{font-size:12px}table{border-collapse:collapse;width:100%;background:#fff}th,td{padding:10px;border:1px solid #dce3ee;text-align:left}th{background:#172033;color:#fff}tr:nth-child(even){background:#f4f7fb}.meta{color:#526174}</style></head><body><h1>Pareto Curve Report</h1><p class="meta">Generated: ${escape(data.generatedAt)} · Expected task mix: ${escape(JSON.stringify(data.costModel))}</p><p class="meta">Policy: ${escape(JSON.stringify(data.policy))}</p><table><thead><tr><th>Rung</th><th>Model</th><th>Provider</th><th>Coding index</th><th>Intelligence index</th><th>Expected task cost</th><th>Pareto optimal</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}
