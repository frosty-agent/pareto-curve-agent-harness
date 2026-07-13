import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

function fail(output) { process.stdout.write(JSON.stringify({ status: "failed", output })); }

try {
  const context = JSON.parse(process.env.PARETO_TASK_CONTEXT ?? "");
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing");
  const prompt = `${context.task.prompt}\n\nYou are working in /workspace. Inspect the repository as needed. Return an applyable unified diff against the current workspace. Do not include markdown fences. Previous attempt context: ${JSON.stringify(context.previousAttempt ?? null)}`;
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "Pareto Curve Agent Harness" },
    body: JSON.stringify({ model: context.model.id, temperature: 0, messages: [{ role: "user", content: prompt }] }),
  });
  if (!response.ok) throw new Error(`OpenRouter worker request failed: ${response.status} ${await response.text()}`);
  const payload = await response.json();
  const diff = payload.choices?.[0]?.message?.content;
  if (!diff || typeof diff !== "string") throw new Error("OpenRouter worker did not return a diff");
  writeFileSync("/tmp/attempt.patch", diff);
  execFileSync("git", ["apply", "--whitespace=fix", "/tmp/attempt.patch"], { cwd: "/workspace", stdio: "pipe" });
  let checks = "";
  try { checks = execFileSync("npm", ["test"], { cwd: "/workspace", encoding: "utf8", timeout: 120000 }); } catch (error) { checks = `${error.stdout ?? ""}\n${error.stderr ?? error.message}`; }
  process.stdout.write(JSON.stringify({ status: "completed", output: `Applied model diff. npm test output:\n${checks}\nDiff:\n${diff}` }));
} catch (error) { fail(error instanceof Error ? error.message : String(error)); }
