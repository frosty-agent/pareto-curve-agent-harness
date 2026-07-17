import { OpenRouter } from "@openrouter/sdk";
import type { ChatFunctionTool, ChatMessages } from "@openrouter/sdk/models";

import type { AgentMessage, OpenRouterResponse, OpenRouterSend } from "./openrouter-agent-runner.js";

function toSdkMessages(messages: AgentMessage[]): ChatMessages[] {
  return messages.map((message): ChatMessages => {
    if (message.role === "system" || message.role === "user") return { role: message.role, content: message.content };
    if (message.role === "tool") {
      if (!message.toolCallId) throw new Error("tool message lacks toolCallId");
      return { role: "tool", toolCallId: message.toolCallId, content: message.content };
    }
    return {
      role: "assistant", content: message.content,
      ...(message.toolCalls?.length ? { toolCalls: message.toolCalls.map((call) => ({ id: call.id, type: "function" as const, function: call.function })) } : {}),
    };
  });
}

/** Creates the only production boundary to the OpenRouter SDK; implicit SDK retries are disabled. */
export function createOpenRouterSend(client: OpenRouter): OpenRouterSend {
  return async (request, signal): Promise<OpenRouterResponse> => {
    const payload = await client.chat.send({
      chatRequest: {
        model: request.model,
        messages: toSdkMessages(request.messages),
        tools: request.tools as ChatFunctionTool[],
        toolChoice: request.toolChoice,
        temperature: request.temperature,
        stream: false,
      },
    }, { signal, retries: { strategy: "none" }, retryCodes: [] });
    return {
      id: payload.id,
      choices: payload.choices.map(({ message }) => ({
        message: {
          content: typeof message.content === "string" || message.content === null ? message.content : JSON.stringify(message.content ?? ""),
          ...(message.toolCalls?.length ? { toolCalls: message.toolCalls.map((call) => ({ id: call.id, function: call.function })) } : {}),
        },
      })),
      ...(payload.usage ? { usage: {
        promptTokens: payload.usage.promptTokens,
        completionTokens: payload.usage.completionTokens,
        ...(typeof payload.usage.cost === "number" ? { cost: payload.usage.cost } : {}),
      } } : {}),
    };
  };
}
