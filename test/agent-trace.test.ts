import assert from "node:assert/strict";
import test from "node:test";

import { traceFromLadderResult } from "../src/agent-trace.js";
import type { LadderResult } from "../src/task-ladder.js";

test("creates ordered v2 agent sessions from worker runtime facts", () => {
  const result: LadderResult = {
    outcome: "success", judgeModel: { id: "judge", codingIndex: 1, intelligenceIndex: 2 },
    workspace: { sourceCommit: "source", baselineCommit: "base", workingDirectory: "/workspace" },
    attempts: [{ attemptNumber: 1, model: { id: "worker-model", codingIndex: 1, intelligenceIndex: 1 }, workerResult: {
      status: "completed", output: "done", trace: { startedAt: "2026-07-14T12:00:00.000Z", endedAt: "2026-07-14T12:00:01.000Z", events: [
        { eventId: "worker-1", sequence: 1, timestamp: "2026-07-14T12:00:00.000Z", type: "agent.message", role: "user", content: "implement task" },
        { eventId: "tool-1", sequence: 2, timestamp: "2026-07-14T12:00:01.000Z", type: "tool.call", toolCallId: "call-1", toolName: "read_file", status: "started" },
      ] },
    } }],
  };

  const trace = traceFromLadderResult(result);
  assert.equal(trace.schemaVersion, "pareto-report/v2");
  assert.deepEqual(trace.agentSessions[0], {
    sessionId: "attempt-1", agent: { id: "worker-model", name: "OpenRouter coding worker" },
    startedAt: "2026-07-14T12:00:00.000Z", endedAt: "2026-07-14T12:00:01.000Z", status: "succeeded",
    events: [
      { eventId: "worker-1", sequence: 1, timestamp: "2026-07-14T12:00:00.000Z", type: "agent.message", role: "user", content: "implement task", attemptNumber: 1 },
      { eventId: "tool-1", sequence: 2, timestamp: "2026-07-14T12:00:01.000Z", type: "tool.call", toolCallId: "call-1", toolName: "read_file", status: "started", attemptNumber: 1 },
    ],
  });
});