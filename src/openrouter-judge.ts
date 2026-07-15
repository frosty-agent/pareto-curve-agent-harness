import { OpenRouter } from "@openrouter/sdk";
import type { JudgeContext, JudgeResult, TaskJudge } from "./task-ladder.js";

export class OpenRouterJudge implements TaskJudge {
  constructor(private readonly apiKey = process.env.OPENROUTER_API_KEY) {
    if (!this.apiKey) throw new Error("OPENROUTER_API_KEY is required for OpenRouterJudge");
  }

  async judge(context: JudgeContext): Promise<JudgeResult> {
    console.error(`[ladder] attempt=${context.attempt.attemptNumber} role=judge model=${context.judgeModel.id} status=started`);
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
    const normalizedContent = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let result: Partial<JudgeResult>;
    try { result = JSON.parse(normalizedContent) as Partial<JudgeResult>; }
    catch { throw new Error(`OpenRouter judge returned invalid JSON result: ${content}`); }
    if (typeof result.successful !== "boolean" || typeof result.learnings !== "string") throw new Error(`OpenRouter judge returned invalid JSON result: ${content}`);
    console.error(`[ladder] attempt=${context.attempt.attemptNumber} role=judge model=${context.judgeModel.id} status=completed successful=${result.successful}`);
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
