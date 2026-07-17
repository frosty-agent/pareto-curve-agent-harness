import assert from "node:assert/strict";
import test from "node:test";

import {
  FROZEN_NINE_RUNG_PARETO_MODELS,
  runGenericOneModelAttempt,
  runFrozenNineRungParetoAttempts,
  type ComparisonDependencies,
} from "../src/comparison-policy.js";

function dependencies(options: {
  resolveOn?: string;
  unavailableOn?: string;
} = {}): {
  dependencies: ComparisonDependencies;
  agentModels: string[];
  testModels: string[];
  snapshots: number[];
  setupCalls: number;
  cleanupCalls: number;
} {
  const agentModels: string[] = [];
  const testModels: string[] = [];
  const snapshots: number[] = [];
  let setupCalls = 0;
  let cleanupCalls = 0;
  return {
    dependencies: {
      workspace: {
        async setup() { setupCalls += 1; return { root: "/tmp/shared-workspace", baselineId: "baseline-1" }; },
        async snapshotAndReset(attempt) { snapshots.push(attempt.attemptNumber); return { path: `/tmp/attempt-${attempt.attemptNumber}.patch`, sha256: "a".repeat(64) }; },
        async cleanup() { cleanupCalls += 1; },
      },
      agent: {
        async run(context) {
          agentModels.push(context.model);
          if (context.model === options.unavailableOn) return { output: "unmetered", calls: [{ actualCostUsd: undefined, costAccountingComplete: false }] };
          return { output: `patched by ${context.model}`, calls: [{ actualCostUsd: 0.25, costAccountingComplete: true }] };
        },
      },
      test: {
        async run(context) {
          testModels.push(context.model);
          return { passed: context.model === options.resolveOn, command: ["node", "--test"], output: "deterministic test output" };
        },
      },
    },
    agentModels,
    testModels,
    snapshots,
    get setupCalls() { return setupCalls; },
    get cleanupCalls() { return cleanupCalls; },
  };
}

test("generic policy uses shared dependencies for exactly one metered model attempt", async () => {
  const fake = dependencies({ resolveOn: "one-model" });

  const result = await runGenericOneModelAttempt({ id: "task-1", prompt: "repair it" }, "one-model", fake.dependencies);

  assert.equal(result.policy, "generic-one-model");
  assert.equal(result.outcome, "resolved");
  assert.deepEqual(fake.agentModels, ["one-model"]);
  assert.deepEqual(fake.testModels, ["one-model"]);
  assert.deepEqual(fake.snapshots, []);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.cost.actualCostUsd, 0.25);
  assert.equal(result.cost.costAccountingComplete, true);
  assert.equal(fake.setupCalls, 1);
  assert.equal(fake.cleanupCalls, 1);
});

test("Pareto policy preserves the frozen nine-rung order, resets rejects, and records cost artifacts", async () => {
  const resolvingModel = FROZEN_NINE_RUNG_PARETO_MODELS[2]!;
  const fake = dependencies({ resolveOn: resolvingModel });

  const result = await runFrozenNineRungParetoAttempts({ id: "task-2", prompt: "repair it" }, fake.dependencies);

  assert.equal(result.policy, "frozen-nine-rung-pareto");
  assert.equal(result.outcome, "resolved");
  assert.deepEqual(fake.agentModels, FROZEN_NINE_RUNG_PARETO_MODELS.slice(0, 3));
  assert.deepEqual(fake.testModels, FROZEN_NINE_RUNG_PARETO_MODELS.slice(0, 3));
  assert.deepEqual(fake.snapshots, [1, 2]);
  assert.equal(result.attempts.length, 3);
  assert.deepEqual(result.attempts.map((attempt) => attempt.model), FROZEN_NINE_RUNG_PARETO_MODELS.slice(0, 3));
  assert.equal(result.attempts[0]?.rejectedPatch?.sha256, "a".repeat(64));
  assert.equal(result.cost.actualCostUsd, 0.75);
  assert.equal(result.cost.costAccountingComplete, true);
});

test("generic policy fails cost accounting closed when an agent returns no provider response ledger", async () => {
  let tested = false;
  const result = await runGenericOneModelAttempt({ id: "task-empty-ledger", prompt: "repair it" }, "one-model", {
    workspace: {
      async setup() { return { root: "/tmp/shared-workspace", baselineId: "baseline-1" }; },
      async snapshotAndReset() { throw new Error("not reached"); },
      async cleanup() {},
    },
    agent: { async run() { return { output: "no dispatch", calls: [] }; } },
    test: { async run() { tested = true; return { passed: true, command: ["node", "--test"], output: "unexpected" }; } },
  });

  assert.equal(result.outcome, "cost_unavailable");
  assert.equal(result.cost.costAccountingComplete, false);
  assert.equal(tested, false);
});

test("Pareto stops without testing or escalating when any provider cost is unavailable", async () => {
  const unavailableModel = FROZEN_NINE_RUNG_PARETO_MODELS[1]!;
  const fake = dependencies({ unavailableOn: unavailableModel });

  const result = await runFrozenNineRungParetoAttempts({ id: "task-3", prompt: "repair it" }, fake.dependencies);

  assert.equal(result.outcome, "cost_unavailable");
  assert.deepEqual(fake.agentModels, FROZEN_NINE_RUNG_PARETO_MODELS.slice(0, 2));
  assert.deepEqual(fake.testModels, [FROZEN_NINE_RUNG_PARETO_MODELS[0]]);
  assert.deepEqual(fake.snapshots, [1]);
  assert.equal(result.cost.costAccountingComplete, false);
  assert.equal(result.cost.actualCostUsd, undefined);
  assert.equal(fake.cleanupCalls, 1);
});
