import assert from "node:assert/strict";
import test from "node:test";

import { renderOwnBenchmarkReport, type OwnBenchmarkReportInput } from "../src/own-benchmark-report.js";

const input: OwnBenchmarkReportInput = {
  experimentId: "verified-own-3",
  systems: ["pareto", "fixed-openai-gpt-5.6-luna"],
  results: [
    {
      taskId: "django__django-11790", systemId: "pareto", evaluator: "resolved",
      actualCostUsd: 0.125, costAccountingComplete: true, durationSeconds: 45, stopReason: "completed",
    },
    {
      taskId: "django__django-11790", systemId: "fixed-openai-gpt-5.6-luna", evaluator: "unresolved",
      actualCostUsd: 0.25, costAccountingComplete: true, durationSeconds: 60, stopReason: "completed",
    },
    {
      taskId: "sphinx-doc__sphinx-10323", systemId: "pareto", evaluator: "resolved",
      actualCostUsd: 0.5, costAccountingComplete: false, durationSeconds: 80, stopReason: "cost_unavailable",
    },
    {
      taskId: "sphinx-doc__sphinx-10323", systemId: "fixed-openai-gpt-5.6-luna", evaluator: "error",
      actualCostUsd: 0.4, costAccountingComplete: true, durationSeconds: 70, stopReason: "provider_error",
    },
  ],
};

test("renders compact CSV rows and pairs aggregate scoring only for tasks scorable by both policies", () => {
  const report = renderOwnBenchmarkReport(input);
  assert.match(report.csv, /task_id,system_id,evaluator,actual_cost_usd,cost_accounting_complete,duration_seconds,stop_reason,scorable/);
  assert.match(report.csv, /django__django-11790,pareto,resolved,0.125000,true,45,completed,true/);
  assert.match(report.csv, /sphinx-doc__sphinx-10323,pareto,resolved,0.500000,false,80,cost_unavailable,false/);
  assert.match(report.markdown, /Paired scorable tasks: 1\/2/);
  assert.match(report.markdown, /\| pareto \| 1\/1 \| \$0\.125000 \| \$0\.125000 \|/);
  assert.match(report.markdown, /\| fixed-openai-gpt-5\.6-luna \| 0\/1 \| \$0\.250000 \| — \|/);
  assert.match(report.markdown, /Unscorable\/audit rows: 2/);
});

test("rejects duplicate task-system result rows and unrecognized system IDs", () => {
  assert.throws(() => renderOwnBenchmarkReport({ ...input, results: [...input.results, input.results[0]!] }), /duplicate/);
  assert.throws(() => renderOwnBenchmarkReport({ ...input, results: [{ ...input.results[0]!, systemId: "other" }] }), /unknown system/);
});
