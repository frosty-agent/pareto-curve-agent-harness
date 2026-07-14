import type { AgentReportEvent } from "./report.js";

export interface LadderModel {
  id: string;
  codingIndex: number;
  intelligenceIndex: number | null;
}

export interface CodingTask {
  id: string;
  prompt: string;
}

export interface WorkspaceInfo {
  sourceCommit: string;
  baselineCommit: string;
  workingDirectory: string;
  artifactsDirectory?: string;
}

export interface ChangeSnapshot {
  path: string;
  attemptNumber: number;
}

export interface AttemptWorkspace {
  setup(): Promise<WorkspaceInfo>;
  snapshotAndReset(attemptNumber: number): Promise<ChangeSnapshot>;
  cleanup(): Promise<void>;
}

export interface WorkerResult {
  status: "completed" | "failed";
  output: string;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
  /** Runtime events emitted by the worker, already safe to include in a report. */
  trace?: { startedAt: string; endedAt: string; events: AgentReportEvent[] };
}

export interface JudgeResult {
  successful: boolean;
  learnings: string;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
}

export interface AttemptRecord {
  attemptNumber: number;
  model: LadderModel;
  workerResult?: WorkerResult;
  judgeResult?: JudgeResult;
  changeSnapshot?: ChangeSnapshot;
  error?: string;
}

export interface PreviousAttempt {
  model: LadderModel;
  workerResult: WorkerResult;
  judgeResult: JudgeResult;
  changeSnapshot?: ChangeSnapshot;
}

export interface WorkerContext {
  attemptNumber: number;
  task: CodingTask;
  model: LadderModel;
  workspace: WorkspaceInfo;
  previousAttempt?: PreviousAttempt;
}

export interface JudgeContext {
  task: CodingTask;
  judgeModel: LadderModel;
  attempt: AttemptRecord;
  workspace: WorkspaceInfo;
}

export interface TaskWorker {
  run(context: WorkerContext): Promise<WorkerResult>;
}

export interface TaskJudge {
  judge(context: JudgeContext): Promise<JudgeResult>;
}

export type LadderOutcome = "success" | "exhausted" | "execution_error" | "judge_error";

export interface LadderResult {
  outcome: LadderOutcome;
  judgeModel: LadderModel;
  workspace: WorkspaceInfo;
  attempts: AttemptRecord[];
  error?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function highestIntelligenceModel(models: LadderModel[]): LadderModel {
  return [...models].sort((left, right) =>
    (right.intelligenceIndex ?? Number.NEGATIVE_INFINITY) - (left.intelligenceIndex ?? Number.NEGATIVE_INFINITY)
    || right.codingIndex - left.codingIndex
    || left.id.localeCompare(right.id),
  )[0]!;
}

function asPreviousAttempt(attempt: AttemptRecord): PreviousAttempt {
  if (!attempt.workerResult || !attempt.judgeResult) throw new Error("Only judged attempts can be retried");
  return {
    model: attempt.model,
    workerResult: attempt.workerResult,
    judgeResult: attempt.judgeResult,
    changeSnapshot: attempt.changeSnapshot,
  };
}

export class ParetoTaskLadder {
  constructor(
    private readonly worker: TaskWorker,
    private readonly judge: TaskJudge,
    private readonly workspaceManager: AttemptWorkspace,
  ) {}

  async run(task: CodingTask, ladder: LadderModel[]): Promise<LadderResult> {
    if (ladder.length === 0) throw new Error("The task ladder requires at least one model");
    const ids = new Set(ladder.map(({ id }) => id));
    if (ids.size !== ladder.length) throw new Error("The task ladder must not contain duplicate model IDs");

    const workspace = await this.workspaceManager.setup();
    const judgeModel = highestIntelligenceModel(ladder);
    const attempts: AttemptRecord[] = [];

    try {
      for (let index = 0; index < ladder.length; index += 1) {
        const model = ladder[index]!;
        const attempt: AttemptRecord = { attemptNumber: index + 1, model };
        attempts.push(attempt);
        const prior = index === 0 ? undefined : asPreviousAttempt(attempts[index - 1]!);

        try {
          attempt.workerResult = await this.worker.run({ attemptNumber: attempt.attemptNumber, task, model, workspace, previousAttempt: prior });
        } catch (error) {
          attempt.error = errorMessage(error);
          return { outcome: "execution_error", judgeModel, workspace, attempts, error: attempt.error };
        }

        try {
          attempt.judgeResult = await this.judge.judge({ task, judgeModel, attempt, workspace });
        } catch (error) {
          attempt.error = errorMessage(error);
          return { outcome: "judge_error", judgeModel, workspace, attempts, error: attempt.error };
        }

        if (attempt.judgeResult.successful) return { outcome: "success", judgeModel, workspace, attempts };
        if (index < ladder.length - 1) {
          try {
            attempt.changeSnapshot = await this.workspaceManager.snapshotAndReset(attempt.attemptNumber);
          } catch (error) {
            attempt.error = errorMessage(error);
            return { outcome: "execution_error", judgeModel, workspace, attempts, error: attempt.error };
          }
        }
      }
      return { outcome: "exhausted", judgeModel, workspace, attempts };
    } finally {
      await this.workspaceManager.cleanup();
    }
  }
}
