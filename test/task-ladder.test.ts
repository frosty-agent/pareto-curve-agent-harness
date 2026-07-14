import assert from "node:assert/strict";
import test from "node:test";

import {
  ParetoTaskLadder,
  type AttemptWorkspace,
  type LadderModel,
  type TaskJudge,
  type TaskWorker,
} from "../src/task-ladder.js";

const models: LadderModel[] = [
  { id: "cheap", codingIndex: 50, intelligenceIndex: 20 },
  { id: "strong", codingIndex: 70, intelligenceIndex: 80 },
];

class FakeWorkspace implements AttemptWorkspace {
  setupCalls = 0;
  resetCalls: number[] = [];
  cleanupCalls = 0;
  snapshotError?: Error;

  async setup() {
    this.setupCalls += 1;
    return { sourceCommit: "source-sha", baselineCommit: "sandbox-sha", workingDirectory: "/tmp/sandbox" };
  }

  async snapshotAndReset(attemptNumber: number) {
    if (this.snapshotError) throw this.snapshotError;
    this.resetCalls.push(attemptNumber);
    return { path: `/tmp/attempt-${attemptNumber}.patch`, attemptNumber };
  }

  async cleanup() {
    this.cleanupCalls += 1;
  }
}

test("judges a worker-reported success with the highest-intelligence model", async () => {
  const workspace = new FakeWorkspace();
  const workerCalls: string[] = [];
  const judgeCalls: string[] = [];
  const worker: TaskWorker = {
    async run(context) {
      workerCalls.push(context.model.id);
      assert.equal(context.attemptNumber, 1);
      assert.equal(context.workspace.sourceCommit, "source-sha");
      return { status: "completed", output: "implemented" };
    },
  };
  const judge: TaskJudge = {
    async judge(context) {
      judgeCalls.push(context.judgeModel.id);
      assert.equal(context.attempt.workerResult?.output, "implemented");
      return { successful: true, learnings: "all checks pass" };
    },
  };

  const result = await new ParetoTaskLadder(worker, judge, workspace).run({ id: "task-1", prompt: "add a feature" }, models);

  assert.equal(result.outcome, "success");
  assert.deepEqual(workerCalls, ["cheap"]);
  assert.deepEqual(judgeCalls, ["strong"]);
  assert.equal(result.attempts.length, 1);
  assert.deepEqual(workspace.resetCalls, []);
  assert.equal(workspace.cleanupCalls, 1);
});

test("retries one rung higher with prior output, learnings, and a reset snapshot", async () => {
  const workspace = new FakeWorkspace();
  const contexts: Array<{ model: string; priorOutput?: string; priorLearnings?: string; priorPatch?: string }> = [];
  const worker: TaskWorker = {
    async run(context) {
      contexts.push({
        model: context.model.id,
        priorOutput: context.previousAttempt?.workerResult.output,
        priorLearnings: context.previousAttempt?.judgeResult?.learnings,
        priorPatch: context.previousAttempt?.changeSnapshot?.path,
      });
      return { status: "completed", output: `${context.model.id} output` };
    },
  };
  let verdict = 0;
  const judge: TaskJudge = {
    async judge() {
      verdict += 1;
      return verdict === 1
        ? { successful: false, learnings: "add tests for the edge case" }
        : { successful: true, learnings: "accepted" };
    },
  };

  const result = await new ParetoTaskLadder(worker, judge, workspace).run({ id: "task-2", prompt: "fix it" }, models);

  assert.equal(result.outcome, "success");
  assert.deepEqual(contexts, [
    { model: "cheap", priorOutput: undefined, priorLearnings: undefined, priorPatch: undefined },
    { model: "strong", priorOutput: "cheap output", priorLearnings: "add tests for the edge case", priorPatch: "/tmp/attempt-1.patch" },
  ]);
  assert.deepEqual(workspace.resetCalls, [1]);
  assert.equal(result.attempts[0].changeSnapshot?.path, "/tmp/attempt-1.patch");
});

test("returns exhausted after every rung is judged unsuccessful", async () => {
  const workspace = new FakeWorkspace();
  const worker: TaskWorker = { async run() { return { status: "failed", output: "could not complete" }; } };
  const judge: TaskJudge = { async judge() { return { successful: false, learnings: "try next" }; } };

  const result = await new ParetoTaskLadder(worker, judge, workspace).run({ id: "task-3", prompt: "hard task" }, models);

  assert.equal(result.outcome, "exhausted");
  assert.equal(result.attempts.length, 2);
  assert.deepEqual(workspace.resetCalls, [1]);
});

test("returns a structured execution error when snapshot/reset fails", async () => {
  const workspace = new FakeWorkspace();
  workspace.snapshotError = new Error("git reset failed");
  const worker: TaskWorker = { async run() { return { status: "completed", output: "worker result" }; } };
  const judge: TaskJudge = { async judge() { return { successful: false, learnings: "retry" }; } };

  const result = await new ParetoTaskLadder(worker, judge, workspace).run({ id: "task-snapshot-error", prompt: "task" }, models);

  assert.equal(result.outcome, "execution_error");
  assert.match(result.error ?? "", /git reset failed/);
  assert.equal(result.attempts.length, 1);
});

test("returns a structured judge error without retrying", async () => {
  const workspace = new FakeWorkspace();
  const worker: TaskWorker = { async run() { return { status: "completed", output: "worker result" }; } };
  const judge: TaskJudge = { async judge() { throw new Error("judge unavailable"); } };

  const result = await new ParetoTaskLadder(worker, judge, workspace).run({ id: "task-judge-error", prompt: "task" }, models);

  assert.equal(result.outcome, "judge_error");
  assert.equal(result.attempts.length, 1);
  assert.match(result.error ?? "", /judge unavailable/);
  assert.deepEqual(workspace.resetCalls, []);
});

test("returns a structured execution error without advancing after a worker exception", async () => {
  const workspace = new FakeWorkspace();
  const worker: TaskWorker = { async run() { throw new Error("sandbox unavailable"); } };
  const judge: TaskJudge = { async judge() { throw new Error("must not be called"); } };

  const result = await new ParetoTaskLadder(worker, judge, workspace).run({ id: "task-4", prompt: "task" }, models);

  assert.equal(result.outcome, "execution_error");
  assert.equal(result.attempts.length, 1);
  assert.match(result.error ?? "", /sandbox unavailable/);
});
