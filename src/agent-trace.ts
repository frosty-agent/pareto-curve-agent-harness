import type { LadderResult } from "./task-ladder.js";
import { REPORT_SCHEMA_VERSION, type TraceReport } from "./report.js";

/** Turns worker-emitted runtime facts into the report's stable v2 session envelope. */
export function traceFromLadderResult(result: LadderResult): TraceReport {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    agentSessions: result.attempts.flatMap((attempt) => {
      const trace = attempt.workerResult?.trace;
      if (!trace) return [];
      return [{
        sessionId: `attempt-${attempt.attemptNumber}`,
        agent: { id: attempt.model.id, name: "OpenRouter coding worker" },
        startedAt: trace.startedAt,
        endedAt: trace.endedAt,
        status: attempt.workerResult?.status === "completed" ? "succeeded" : "failed",
        events: trace.events.map((event) => ({ ...event, attemptNumber: attempt.attemptNumber })),
      }];
    }),
  };
}