import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

async function source(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), "utf8");
}

test("AGE-9 runner contract keeps the complete attempt loop inside one container", async () => {
  const [dockerfile, runner, contract, worker] = await Promise.all([
    source("Dockerfile.runner"),
    source("src/container-run.ts"),
    source("docs/AGE-9-docker-runner-contract.md"),
    source("open-agent-worker.mjs"),
  ]);

  // The image builds the verified fork and supplies the runner code; runtime receives only source, reports, and a secret env var.
  assert.match(dockerfile, /FROM node:22\.22\.3-alpine AS open-agent-sdk/);
  assert.match(dockerfile, /frosty-agent\/open-agent-sdk-typescript\.git/);
  assert.match(dockerfile, /checkout --quiet 6933905657de3349ad34d88737f09807dbc4b75e/);
  assert.match(dockerfile, /RUN npm ci && npm run build/);
  assert.match(dockerfile, /COPY --from=open-agent-sdk \/opt\/open-agent-sdk \/opt\/open-agent-sdk/);
  assert.match(dockerfile, /COPY src \.\/src/);
  assert.match(dockerfile, /COPY open-agent-worker\.mjs \.\/open-agent-worker\.mjs/);
  assert.match(dockerfile, /RUN chmod 0444 \/app\/open-agent-worker\.mjs && chown -R node:node \/app \/opt\/open-agent-sdk/);
  // The runner executes as node and must be able to create its disposable Git clone.
  assert.match(dockerfile, /RUN mkdir -p \/workspace \/reports && chown -R node:node \/workspace \/reports/);
  assert.match(dockerfile, /ENTRYPOINT \["node", "--import", "tsx", "src\/container-run\.ts"\]/);
  assert.match(dockerfile, /mount the target repository read-only at \/source and a host output directory at \/reports/);
  assert.match(dockerfile, /OPENROUTER_API_KEY is injected with docker -e, never copied into the image/);

  // These are deliberately direct calls in the runner, not orchestration delegated to the host.
  assert.match(runner, /const source = "\/source"/);
  assert.match(runner, /const workspaceDirectory = "\/workspace"/);
  // `/workspace` is an image-owned top-level directory: the node user can clear it, not remove it from `/`.
  assert.match(runner, /await mkdir\(workspaceDirectory, \{ recursive: true \}\)/);
  assert.match(runner, /for \(const entry of await readdir\(workspaceDirectory\)\)/);
  assert.doesNotMatch(runner, /rm\(workspaceDirectory, \{ recursive: true, force: true \}\)/);
  assert.match(runner, /const reportsDirectory = "\/reports"/);
  assert.match(runner, /git", \["clone", "-q", source, workspaceDirectory\]/);
  // Dependency installs must not make retry patch capture exceed its buffer or pollute artifacts.
  assert.match(runner, /"\:\(exclude\)node_modules"/);
  assert.match(runner, /execFile\("node", \["\/app\/open-agent-worker\.mjs"\]/);
  assert.match(runner, /const catalog = await fetchCatalog\(\)/);
  assert.match(runner, /buildLadder\(normalizeCatalog\(catalog/);
  assert.match(runner, /new ParetoTaskLadder\(new InContainerOpenRouterWorker\(\), new OpenRouterJudge\(\), new ContainerWorkspace\(\)\)\.run/);
  assert.match(runner, /await writeReports\(report, reportsDirectory\)/);

  // The fork Agent owns the tool-call/result loop, but only receives workspace-scoped tools.
  assert.match(worker, /import \{ Agent \} from "\/opt\/open-agent-sdk\/dist\/index\.js"/);
  assert.match(worker, /apiType: "openrouter"/);
  assert.match(worker, /tools: workspaceTools/);
  assert.match(worker, /await agent\.prompt\(/);
  assert.match(worker, /instrumentTool\("write_file"/);
  assert.match(worker, /instrumentTool\("bash"/);
  assert.match(worker, /execFileSync\("sh", \["-lc", input\.command\]/);
  assert.doesNotMatch(worker, /Command is not allowlisted/);
  assert.match(worker, /process\.once\("SIGTERM", cancel\)/);
  assert.match(worker, /abortController,/);
  // Runtime tool calls and their wrapper hook lifecycle become v2 report facts.
  assert.match(worker, /type: "tool\.call"/);
  assert.match(worker, /type: "tool\.result"/);
  assert.match(worker, /type: "hook\.started"/);
  assert.match(worker, /type: "hook\.completed"/);
  assert.match(worker, /trace: trace\(\)/);

  // No Docker child worker or host-orchestrated per-model loop is permitted inside the runner.
  assert.doesNotMatch(runner, /DockerCommandWorker|DockerGitWorkspace|docker\s+run|docker\.sock/i);
  assert.doesNotMatch(worker, /docker\s+run|docker\.sock/i);
  assert.match(contract, /## No-host-loop invariant/);
  assert.match(contract, /No host process may perform the per-model attempt loop/);
});
