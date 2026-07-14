import { OpenRouter } from "@openrouter/sdk";
import type { JudgeContext, JudgeResult, TaskJudge } from "./task-ladder.js";

export class OpenRouterJudge implements TaskJudge {
  constructor(private readonly apiKey = process.env.OPENROUTER_API_KEY) {
    if (!this.apiKey) throw new Error("OPENROUTER_API_KEY is required for OpenRouterJudge");
  }

  async judge(context: JudgeContext): Promise<JudgeResult> {
    const client = new OpenRouter({ apiKey: this.apiKey, appTitle: "Pareto Curve Agent Harness" });
    const payload = await client.chat.send({
      chatRequest: {
        model: context.judgeModel.id,
      temperature: 0,
      responseFormat: { type: "json_object" },
      messages: [
        { role: "system", content: "You are a strict coding-task judge. Return only JSON: {successful:boolean, learnings:string}. Judge against the task and evidence; do not trust the worker's claimed success." },
        { role: "user", content: JSON.stringify({ task: context.task, attempt: context.attempt, workspace: { sourceCommit: context.workspace.sourceCommit, baselineCommit: context.workspace.baselineCommit } }) },
      ],
      },
    });
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenRouter judge response did not contain a message");
    const result = JSON.parse(content) as Partial<JudgeResult>;
    if (typeof result.successful !== "boolean" || typeof result.learnings !== "string") throw new Error("OpenRouter judge returned invalid JSON result");
    return {
      successful: result.successful,
      learnings: result.learnings,
      usage: {
        inputTokens: payload.usage?.promptTokens,
        outputTokens: payload.usage?.completionTokens,
        ...(payload.usage?.cost === null || payload.usage?.cost === undefined ? {} : { costUsd: payload.usage.cost }),
      },
    };
  }
}
