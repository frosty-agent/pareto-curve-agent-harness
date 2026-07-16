export type AgentRole = "system" | "user" | "assistant" | "tool";

export interface AgentMessage {
  role: AgentRole;
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export interface ToolExecutionResult {
  content: string;
  isError?: boolean;
}

export interface OpenRouterUsage {
  promptTokens?: number;
  prompt_tokens?: number;
  completionTokens?: number;
  completion_tokens?: number;
  cost?: number;
}

export interface OpenRouterResponse {
  id?: string;
  usage?: OpenRouterUsage;
  choices?: Array<{ message?: { content?: string | null; toolCalls?: ToolCall[] } }>;
}

export interface OpenRouterRequest {
  model: string;
  messages: AgentMessage[];
  tools: unknown[];
  toolChoice: "auto";
  temperature: number;
}

/** A narrow adapter over @openrouter/sdk's chat.send(), deliberately easy to fake in tests. */
export type OpenRouterSend = (request: OpenRouterRequest, signal: AbortSignal) => Promise<OpenRouterResponse>;
export type ToolExecutor = (call: ToolCall, signal: AbortSignal) => Promise<ToolExecutionResult>;

export interface OpenRouterAgentRunInput {
  model: string;
  initialMessages: AgentMessage[];
  tools: unknown[];
  send: OpenRouterSend;
  executeTool: ToolExecutor;
  maxTurns: number;
  deadlineEpochMs: number;
  signal?: AbortSignal;
}

export interface OpenRouterCallRecord {
  model: string;
  responseId?: string;
  startedAt: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  /** OpenRouter response usage.cost; never an estimate derived from model pricing. */
  actualCostUsd?: number;
  costAccountingComplete: boolean;
}

export type OpenRouterAgentStopReason =
  | "completed"
  | "turn_limit"
  | "deadline"
  | "cancelled"
  | "provider_error"
  | "malformed_response"
  | "cost_unavailable";

export type OpenRouterAgentFailureStopReason = Exclude<OpenRouterAgentStopReason, "completed" | "turn_limit">;

export interface OpenRouterAgentRunResult {
  status: "completed" | "failed";
  stopReason: OpenRouterAgentStopReason;
  output: string;
  messages: AgentMessage[];
  calls: OpenRouterCallRecord[];
  inputTokens: number;
  outputTokens: number;
  actualCostUsd?: number;
  costAccountingComplete: boolean;
  error?: string;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function actualCost(usage: OpenRouterUsage | undefined): number | undefined {
  const value = usage?.cost;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function deadlineError(deadlineEpochMs: number): Error {
  return new Error(`OpenRouter task deadline exceeded at ${new Date(deadlineEpochMs).toISOString()}`);
}

function mergedSignal(parent: AbortSignal | undefined, deadlineEpochMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent?.reason ?? new Error("OpenRouter run cancelled"));
  if (parent?.aborted) onAbort();
  else parent?.addEventListener("abort", onAbort, { once: true });
  const timeoutMs = Math.max(0, deadlineEpochMs - Date.now());
  const timer = setTimeout(() => controller.abort(deadlineError(deadlineEpochMs)), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => { clearTimeout(timer); parent?.removeEventListener("abort", onAbort); },
  };
}

function classifyAbort(signal: AbortSignal, deadlineEpochMs: number): OpenRouterAgentFailureStopReason {
  if (Date.now() >= deadlineEpochMs || signal.reason instanceof Error && signal.reason.message.includes("deadline")) return "deadline";
  return "cancelled";
}

function failed(
  stopReason: OpenRouterAgentFailureStopReason,
  messages: AgentMessage[],
  calls: OpenRouterCallRecord[],
  inputTokens: number,
  outputTokens: number,
  costAccountingComplete: boolean,
  totalCost: number,
  error: unknown,
): OpenRouterAgentRunResult {
  return {
    status: "failed", stopReason, output: "", messages, calls, inputTokens, outputTokens,
    ...(costAccountingComplete ? { actualCostUsd: totalCost } : {}),
    costAccountingComplete,
    error: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Runs one model through bounded tool calls. This is policy-neutral: a fixed-model
 * caller invokes it once; a Pareto policy invokes it once for each recorded rung.
 */
export async function runOpenRouterAgent(input: OpenRouterAgentRunInput): Promise<OpenRouterAgentRunResult> {
  if (!input.model) throw new Error("model is required");
  if (!Number.isInteger(input.maxTurns) || input.maxTurns <= 0) throw new Error("maxTurns must be a positive integer");
  if (!Number.isFinite(input.deadlineEpochMs)) throw new Error("deadlineEpochMs must be finite");

  const messages = [...input.initialMessages];
  const calls: OpenRouterCallRecord[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let totalCost = 0;
  let costAccountingComplete = true;

  for (let turn = 0; turn < input.maxTurns; turn += 1) {
    if (input.signal?.aborted) return failed(classifyAbort(input.signal, input.deadlineEpochMs), messages, calls, inputTokens, outputTokens, costAccountingComplete, totalCost, input.signal.reason);
    if (Date.now() >= input.deadlineEpochMs) return failed("deadline", messages, calls, inputTokens, outputTokens, costAccountingComplete, totalCost, deadlineError(input.deadlineEpochMs));

    const started = Date.now();
    const requestSignal = mergedSignal(input.signal, input.deadlineEpochMs);
    let response: OpenRouterResponse;
    try {
      response = await input.send({ model: input.model, messages, tools: input.tools, toolChoice: "auto", temperature: 0 }, requestSignal.signal);
    } catch (error) {
      requestSignal.cleanup();
      return failed(requestSignal.signal.aborted ? classifyAbort(requestSignal.signal, input.deadlineEpochMs) : "provider_error", messages, calls, inputTokens, outputTokens, costAccountingComplete, totalCost, error);
    }
    requestSignal.cleanup();

    const usage = response.usage;
    const callCost = actualCost(usage);
    const complete = callCost !== undefined;
    inputTokens += numberOrZero(usage?.promptTokens ?? usage?.prompt_tokens);
    outputTokens += numberOrZero(usage?.completionTokens ?? usage?.completion_tokens);
    if (complete) totalCost += callCost;
    else costAccountingComplete = false;
    calls.push({
      model: input.model,
      responseId: response.id,
      startedAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      inputTokens: numberOrZero(usage?.promptTokens ?? usage?.prompt_tokens),
      outputTokens: numberOrZero(usage?.completionTokens ?? usage?.completion_tokens),
      ...(complete ? { actualCostUsd: callCost } : {}),
      costAccountingComplete: complete,
    });
    if (!complete) return failed("cost_unavailable", messages, calls, inputTokens, outputTokens, false, totalCost, new Error("OpenRouter response omitted valid usage.cost"));

    const message = response.choices?.[0]?.message;
    if (!message) return failed("malformed_response", messages, calls, inputTokens, outputTokens, costAccountingComplete, totalCost, new Error("OpenRouter response omitted choices[0].message"));
    const assistant: AgentMessage = { role: "assistant", content: String(message.content ?? ""), ...(message.toolCalls?.length ? { toolCalls: message.toolCalls } : {}) };
    messages.push(assistant);
    if (!message.toolCalls?.length) {
      return { status: "completed", stopReason: "completed", output: assistant.content, messages, calls, inputTokens, outputTokens, actualCostUsd: totalCost, costAccountingComplete: true };
    }

    for (const call of message.toolCalls) {
      if (Date.now() >= input.deadlineEpochMs) return failed("deadline", messages, calls, inputTokens, outputTokens, costAccountingComplete, totalCost, deadlineError(input.deadlineEpochMs));
      const toolSignal = mergedSignal(input.signal, input.deadlineEpochMs);
      let result: ToolExecutionResult;
      try {
        result = await input.executeTool(call, toolSignal.signal);
      } catch (error) {
        result = { content: `Tool error: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      } finally {
        toolSignal.cleanup();
      }
      messages.push({ role: "tool", toolCallId: call.id, content: result.content });
    }
  }

  return { status: "completed", stopReason: "turn_limit", output: "Tool budget exhausted", messages, calls, inputTokens, outputTokens, actualCostUsd: totalCost, costAccountingComplete: true };
}
