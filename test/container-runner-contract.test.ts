import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

async function source(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), "utf8");
}

test("AGE-9 runner contract keeps the complete attempt loop inside one container", async () => {
  const [dockerfile, runner, contract] = await Promise.all([
    source("Dockerfile.runner"),
    source("src/container-run.ts"),
    source("docs/AGE-9-docker-runner-contract.md"),
  ]);

  // The image supplies the runner code; runtime receives only source, reports, and a secret env var.
  assert.match(dockerfile, /COPY src \.\/src/);
  assert.match(dockerfile, /COPY openrouter-worker\.mjs \.\/openrouter-worker\.mjs/);
  assert.match(dockerfile, /ENTRYPOINT \["node", "--import", "tsx", "src\/container-run\.ts"\]/);
  assert.match(dockerfile, /mount the target repository read-only at \/source and a host output directory at \/reports/);
  assert.match(dockerfile, /OPENROUTER_API_KEY is injected with docker -e, never copied into the image/);

  // These are deliberately direct calls in the runner, not orchestration delegated to the host.
  assert.match(runner, /const source = "\/source"/);
  assert.match(runner, /const workspaceDirectory = "\/workspace"/);
  assert.match(runner, /const reportsDirectory = "\/reports"/);
  assert.match(runner, /git", \["clone", "-q", source, workspaceDirectory\]/);
  assert.match(runner, /execFile\("node", \["\/app\/openrouter-worker\.mjs"\]/);
  assert.match(runner, /const catalog = await fetchCatalog\(\)/);
  assert.match(runner, /buildLadder\(normalizeCatalog\(catalog/);
  assert.match(runner, /new ParetoTaskLadder\(new InContainerOpenRouterWorker\(\), new OpenRouterJudge\(\), new ContainerWorkspace\(\)\)\.run/);
  assert.match(runner, /await writeReports\(report, reportsDirectory\)/);

  // No Docker child worker or host-orchestrated per-model loop is permitted inside the runner.
  assert.doesNotMatch(runner, /DockerCommandWorker|DockerGitWorkspace|docker\s+run|docker\.sock/i);
  assert.match(contract, /## No-host-loop invariant/);
  assert.match(contract, /No host process may perform the per-model attempt loop/);
});
