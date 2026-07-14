import assert from "node:assert/strict";
import test from "node:test";

import { REPORT_SCHEMA_VERSION, redactReportSecrets, renderHtml, type TraceReport } from "../src/report.js";

test("renders a mobile-safe, escaped agent trace containing tool, hook, and MCP events", () => {
  const trace: TraceReport = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    agentSessions: [{
      sessionId: "session-1",
      agent: { id: "worker", name: "Worker <one>", version: "1.0.0" },
      startedAt: "2026-07-14T12:00:00.000Z",
      endedAt: "2026-07-14T12:00:03.000Z",
      status: "failed",
      events: [
        { eventId: "e1", sequence: 1, timestamp: "2026-07-14T12:00:00.000Z", type: "tool.call", toolCallId: "call-1", toolName: "shell", status: "started", input: { command: "echo <unsafe>" } },
        { eventId: "e2", sequence: 2, timestamp: "2026-07-14T12:00:01.000Z", parentEventId: "e1", type: "hook.completed", hookId: "h1", hookName: "policy", phase: "pre", status: "succeeded", durationMs: 4 },
        { eventId: "e3", sequence: 3, timestamp: "2026-07-14T12:00:02.000Z", type: "mcp.tool_result", serverId: "github", serverName: "GitHub", transport: "stdio", toolCallId: "call-2", toolName: "issues.list", status: "failed", error: { name: "Error", message: "denied" } },
      ],
    }],
  };
  const html = renderHtml({ generatedAt: "2026-07-14T12:00:03.000Z", trace });
  assert.match(html, /name="viewport" content="width=device-width,initial-scale=1"/);
  assert.match(html, /Agent sessions/);
  assert.match(html, /tool.call: shell/);
  assert.match(html, /hook.completed: policy/);
  assert.match(html, /mcp.tool_result: GitHub \/ issues.list/);
  assert.match(html, /Worker &lt;one&gt;/);
  assert.doesNotMatch(html, /echo <unsafe>/);
  assert.match(html, /echo &lt;unsafe&gt;/);
});

test("redacts credential fields and bearer-style values before report persistence", () => {
  const redacted = redactReportSecrets({ apiKey: "sk-or-should-not-appear", nested: { authorization: "Bearer private-token" }, output: "used sk-ant-example" });
  assert.deepEqual(redacted, { apiKey: "[REDACTED]", nested: { authorization: "[REDACTED]" }, output: "used [REDACTED]" });
});
