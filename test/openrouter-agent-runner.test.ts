import assert from "node:assert/strict";
import test from "node:test";

import { runOpenRouterAgent, type OpenRouterResponse } from "../src/openrouter-agent-runner.js";

const deadline = () => Date.now() + 5_000;
const tools = [{ type: "function", function: { name: "read_file" } }];
const response = (message: { content?: string | null; toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }> }, cost = 0.12): OpenRouterResponse => ({
  id: "gen-1",
  usage: { promptTokens: 10, completionTokens: 5, cost },
  choices: [{ message }],
});

test("returns authoritative actual cost for a text completion", async () => {
  const result = await runOpenRouterAgent({
    model: "openai/gpt-5.6-luna",
    initialMessages: [{ role: "user", content: "Fix it" }], tools, maxTurns: 3, deadlineEpochMs: deadline(),
    send: async () => response({ content: "done" }, 0.25),
    executeTool: async () => ({ content: "unused" }),
  });
  assert.equal(result.status, "completed");
  assert.equal(result.stopReason, "completed");
  assert.equal(result.actualCostUsd, 0.25);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0]?.actualCostUsd, 0.25);
});

test("executes tool calls and continues the same conversation", async () => {
  let invocation = 0;
  const result = await runOpenRouterAgent({
    model: "test/model", initialMessages: [{ role: "user", content: "inspect" }], tools, maxTurns: 3, deadlineEpochMs: deadline(),
    send: async (request) => {
      invocation += 1;
      if (invocation === 1) {
        assert.equal(request.messages.length, 1);
        return response({ content: null, toolCalls: [{ id: "call-1", function: { name: "read_file", arguments: '{"path":"a"}' } }] }, 0.1);
      }
      assert.equal(request.messages.at(-1)?.role, "tool");
      return response({ content: "fixed" }, 0.2);
    },
    executeTool: async (call) => ({ content: `contents for ${call.function.name}` }),
  });
  assert.equal(result.output, "fixed");
  assert.ok(Math.abs((result.actualCostUsd ?? 0) - 0.3) < 1e-12);
  assert.equal(result.calls.length, 2);
});

test("fails closed when OpenRouter omits provider-reported cost", async () => {
  const result = await runOpenRouterAgent({
    model: "test/model", initialMessages: [{ role: "user", content: "x" }], tools, maxTurns: 1, deadlineEpochMs: deadline(),
    send: async () => ({ choices: [{ message: { content: "done" } }], usage: { promptTokens: 1, completionTokens: 1 } }),
    executeTool: async () => ({ content: "unused" }),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.stopReason, "cost_unavailable");
  assert.equal(result.costAccountingComplete, false);
  assert.equal(result.actualCostUsd, undefined);
});

test("does not retry a provider error", async () => {
  let calls = 0;
  const result = await runOpenRouterAgent({
    model: "test/model", initialMessages: [{ role: "user", content: "x" }], tools, maxTurns: 3, deadlineEpochMs: deadline(),
    send: async () => { calls += 1; throw new Error("503"); },
    executeTool: async () => ({ content: "unused" }),
  });
  assert.equal(result.stopReason, "provider_error");
  assert.equal(calls, 1);
});

test("returns deadline without dispatching after expiry", async () => {
  let dispatched = false;
  const result = await runOpenRouterAgent({
    model: "test/model", initialMessages: [{ role: "user", content: "x" }], tools, maxTurns: 1, deadlineEpochMs: Date.now() - 1,
    send: async () => { dispatched = true; return response({ content: "unexpected" }); },
    executeTool: async () => ({ content: "unused" }),
  });
  assert.equal(result.stopReason, "deadline");
  assert.equal(dispatched, false);
});
