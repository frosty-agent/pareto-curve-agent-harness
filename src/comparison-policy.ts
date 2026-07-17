import { FROZEN_PARETO_LADDER_IDS } from "./benchmark-manifest.js";

/** The recorded ladder is copied and frozen here so callers cannot reorder or shorten Pareto attempts. */
export const FROZEN_NINE_RUNG_PARETO_MODELS: readonly string[] = Object.freeze([...FROZEN_PARETO_LADDER_IDS]);

export interface ComparisonTask {
  id: string;
  prompt: string;
}

export interface ComparisonWorkspace {
  root: string;
  baselineId: string;
}

export interface RejectedPatchArtifact {
  path: string;
  sha256: string;
}

export interface ComparisonWorkspaceManager {
  setup(): Promise<ComparisonWorkspace>;
  snapshotAndReset(attempt: ComparisonAttemptArtifact): Promise<RejectedPatchArtifact>;
  cleanup(): Promise<void>;
}

/** One provider response's authoritative accounting state, not a model-price estimate. */
export interface ProviderCostCall {
  actualCostUsd?: number;
  costAccountingComplete: boolean;
}

export interface SharedAgentResult {
  output: string;
  calls: readonly ProviderCostCall[];
}

export interface SharedAgentContext {
  task: ComparisonTask;
  model: string;
  attemptNumber: number;
  workspace: ComparisonWorkspace;
}

export interface SharedAgent {
  run(context: SharedAgentContext): Promise<SharedAgentResult>;
}

export interface DeterministicTestResult {
  passed: boolean;
  command: readonly string[];
  output: string;
}

export interface SharedTestContext extends SharedAgentContext {
  agent: SharedAgentResult;
}

export interface SharedTestRunner {
  run(context: SharedTestContext): Promise<DeterministicTestResult>;
}

/** Dependencies are supplied once and shared unchanged by fixed and Pareto policies. */
export interface ComparisonDependencies {
  agent: SharedAgent;
  test: SharedTestRunner;
  workspace: ComparisonWorkspaceManager;
}

export interface CostArtifact {
  /** Defined only when every dispatched provider response had a finite authoritative cost. */
  actualCostUsd?: number;
  /** Sum of costs known before a missing-cost stop; never substituted into aggregate scoring. */
  knownActualCostUsd: number;
  costAccountingComplete: boolean;
  calls: readonly (ProviderCostCall & { model: string })[];
}

export interface ComparisonAttemptArtifact {
  attemptNumber: number;
  model: string;
  agent?: SharedAgentResult;
  test?: DeterministicTestResult;
  rejectedPatch?: RejectedPatchArtifact;
  error?: string;
}

export type ComparisonOutcome = "resolved" | "unresolved" | "cost_unavailable" | "error";
export type ComparisonPolicy = "generic-one-model" | "frozen-nine-rung-pareto";

export interface ComparisonResultArtifact {
  policy: ComparisonPolicy;
  taskId: string;
  workspace: ComparisonWorkspace;
  outcome: ComparisonOutcome;
  attempts: readonly ComparisonAttemptArtifact[];
  cost: CostArtifact;
  error?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function authoritativeCost(call: ProviderCostCall): number | undefined {
  const cost = call.actualCostUsd;
  return call.costAccountingComplete && typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}

function costArtifact(attempts: readonly ComparisonAttemptArtifact[]): CostArtifact {
  const calls = attempts.flatMap((attempt) => (attempt.agent?.calls ?? []).map((call) => ({ ...call, model: attempt.model })));
  const complete = calls.length > 0 && calls.every((call) => authoritativeCost(call) !== undefined);
  const knownActualCostUsd = calls.reduce((total, call) => total + (authoritativeCost(call) ?? 0), 0);
  return {
    ...(complete ? { actualCostUsd: knownActualCostUsd } : {}),
    knownActualCostUsd,
    costAccountingComplete: complete,
    calls,
  };
}

function result(
  policy: ComparisonPolicy,
  task: ComparisonTask,
  workspace: ComparisonWorkspace,
  outcome: ComparisonOutcome,
  attempts: ComparisonAttemptArtifact[],
  error?: string,
): ComparisonResultArtifact {
  return { policy, taskId: task.id, workspace, outcome, attempts, cost: costArtifact(attempts), ...(error ? { error } : {}) };
}

async function executeAttempt(
  task: ComparisonTask,
  model: string,
  attemptNumber: number,
  workspace: ComparisonWorkspace,
  dependencies: ComparisonDependencies,
): Promise<ComparisonAttemptArtifact> {
  const attempt: ComparisonAttemptArtifact = { attemptNumber, model };
  const context: SharedAgentContext = Object.freeze({ task, model, attemptNumber, workspace });
  try {
    attempt.agent = await dependencies.agent.run(context);
  } catch (error) {
    attempt.error = errorMessage(error);
    return attempt;
  }
  if (!costArtifact([attempt]).costAccountingComplete) return attempt;
  try {
    attempt.test = await dependencies.test.run({ ...context, agent: attempt.agent });
  } catch (error) {
    attempt.error = errorMessage(error);
  }
  return attempt;
}

/** Runs exactly one supplied model with the same injected workspace, agent, and deterministic test boundary. */
export async function runGenericOneModelAttempt(
  task: ComparisonTask,
  model: string,
  dependencies: ComparisonDependencies,
): Promise<ComparisonResultArtifact> {
  if (!model.trim()) throw new Error("generic model must be nonempty");
  const workspace = await dependencies.workspace.setup();
  const attempts: ComparisonAttemptArtifact[] = [];
  try {
    const attempt = await executeAttempt(task, model, 1, workspace, dependencies);
    attempts.push(attempt);
    if (attempt.error) return result("generic-one-model", task, workspace, "error", attempts, attempt.error);
    if (!costArtifact(attempts).costAccountingComplete) return result("generic-one-model", task, workspace, "cost_unavailable", attempts);
    return result("generic-one-model", task, workspace, attempt.test?.passed ? "resolved" : "unresolved", attempts);
  } finally {
    await dependencies.workspace.cleanup();
  }
}

/**
 * Runs only the immutable recorded nine-rung ordering. Rejected attempts are snapshotted
 * and reset before the next rung; a missing authoritative response cost stops escalation.
 */
export async function runFrozenNineRungParetoAttempts(
  task: ComparisonTask,
  dependencies: ComparisonDependencies,
): Promise<ComparisonResultArtifact> {
  const workspace = await dependencies.workspace.setup();
  const attempts: ComparisonAttemptArtifact[] = [];
  try {
    for (const [index, model] of FROZEN_NINE_RUNG_PARETO_MODELS.entries()) {
      const attempt = await executeAttempt(task, model, index + 1, workspace, dependencies);
      attempts.push(attempt);
      if (attempt.error) return result("frozen-nine-rung-pareto", task, workspace, "error", attempts, attempt.error);
      if (!costArtifact(attempts).costAccountingComplete) return result("frozen-nine-rung-pareto", task, workspace, "cost_unavailable", attempts);
      if (attempt.test?.passed) return result("frozen-nine-rung-pareto", task, workspace, "resolved", attempts);
      if (index < FROZEN_NINE_RUNG_PARETO_MODELS.length - 1) {
        try {
          attempt.rejectedPatch = await dependencies.workspace.snapshotAndReset(attempt);
        } catch (error) {
          attempt.error = errorMessage(error);
          return result("frozen-nine-rung-pareto", task, workspace, "error", attempts, attempt.error);
        }
      }
    }
    return result("frozen-nine-rung-pareto", task, workspace, "unresolved", attempts);
  } finally {
    await dependencies.workspace.cleanup();
  }
}
