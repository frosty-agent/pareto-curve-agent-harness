import type { JudgeContext, JudgeResult, TaskJudge } from "./task-ladder.js";

export class OpenRouterJudge implements TaskJudge {
  constructor(private readonly apiKey = process.env.OPENROUTER_API_KEY) {
    if (!this.apiKey) throw new Error("OPENROUTER_API_KEY is required for OpenRouterJudge");
  }

  async judge(context: JudgeContext): Promise<JudgeResult> {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", "X-Title": "Pareto Curve Agent Harness" },
      body: JSON.stringify({
        model: context.judgeModel.id,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a strict coding-task judge. Return only JSON: {successful:boolean, learnings:string}. Judge against the task and evidence; do not trust the worker's claimed success." },
          { role: "user", content: JSON.stringify({ task: context.task, attempt: context.attempt, workspace: { sourceCommit: context.workspace.sourceCommit, baselineCommit: context.workspace.baselineCommit } }) },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`OpenRouter judge request failed: ${response.status} ${await response.text()}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenRouter judge response did not contain a message");
    const result = JSON.parse(content) as Partial<JudgeResult>;
    if (typeof result.successful !== "boolean" || typeof result.learnings !== "string") throw new Error("OpenRouter judge returned invalid JSON result");
    return { successful: result.successful, learnings: result.learnings };
  }
}
