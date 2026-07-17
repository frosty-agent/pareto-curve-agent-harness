# Pareto Curve Agent Harness

A Dockerized TypeScript CLI that derives an explicit, observable coding-capability vs. expected-cost ladder from the [OpenRouter Models API](https://openrouter.ai/api/v1/models).

It uses OpenRouter's concrete executable model IDs, token pricing, and embedded Artificial Analysis benchmark scores. It does **not** scrape the OpenRouter Pareto Router UI.

## Output

The CLI writes JSON containing up to 10 models by default. Every model contains:

- `codingIndex`, `intelligenceIndex`, and `agenticIndex`
- expected cost for the supplied input/output token mix
- input/output price per million tokens
- explicit image/video input/output capability booleans
- `isParetoOptimal`, distinguishing the strict cost-vs-coding frontier from dominated fill models

## Run with Docker

Build the image:

```bash
docker build -t pareto-curve-agent-harness .
```

The public catalog can be read without auth:

```bash
docker run --rm pareto-curve-agent-harness \
  --input-tokens 10000 --output-tokens 2000 --limit 10 --exclude-preview
```

To pass the OpenRouter key from AWS Secrets Manager without storing it in the image or repository:

Retrieve `SecretString` from AWS Secrets Manager for `pareto-curve-openrouter-api-key`, export it into `OPENROUTER_API_KEY` in your shell, then run:

```bash
docker run --rm -e OPENROUTER_API_KEY pareto-curve-agent-harness \
  --input-tokens 10000 --output-tokens 2000 --limit 10 --exclude-preview
```

Unset `OPENROUTER_API_KEY` after the run.

The key is optional for the catalog endpoint. When supplied, the CLI sends it only as an OpenRouter authorization header and reports `authConfigured: true`; it never prints the key.

## Run a coding task ladder

Build the dedicated runner image:

```bash
docker build -f Dockerfile.runner -t pareto-runner:latest .
```

Run a prompt against a target Git repository. Docker and a reachable Docker daemon are required; the wrapper checks both before starting. Export `OPENROUTER_API_KEY` in your shell (or retrieve it from your secret manager) first:

```bash
export OPENROUTER_API_KEY="…"
scripts/run-ladder.sh \
  --prompt 'Implement the requested feature and run the project checks.' \
  --source /path/to/target-repository \
  --reports /tmp/pareto-reports
```

The target source is bind-mounted read-only at `/source`; reports (JSON, HTML, and retry patches) are written to `--reports`. The runner emits progress lines for each ladder invocation, including attempt number, model ID, and whether it is a worker or judge.

By default, task work occurs in the runner's disposable `/workspace`. To retain or inspect the isolated cloned workspace on the host, provide an explicit workspace volume:

```bash
scripts/run-ladder.sh --prompt '…' --source /path/to/target-repository \
  --workspace /tmp/pareto-workspace --reports /tmp/pareto-reports
```

Run `scripts/run-ladder.sh --help` for all options.

## Policy controls

```bash
# Limit providers and require tool-calling support
docker run --rm pareto-curve-agent-harness \
  --allow-provider openai,anthropic,google \
  --require-tools \
  --exclude-preview
```

Models must have an AA Coding Index to be eligible. The program removes dominated models—models for which another eligible model is at least as capable and no more expensive—then orders the frontier from lower to higher Coding Index. If the strict frontier has fewer than `--limit` models, dominated models are appended and marked `isParetoOptimal: false`.

## Pareto task ladder primitive

`ParetoTaskLadder` owns deterministic worker escalation; callers provide provider-specific `TaskWorker` and `TaskJudge` adapters. It always chooses the first supplied ladder model for the worker and the model with the highest `intelligenceIndex` for judgment. A worker-reported success is still judged.

`DockerGitWorkspace` isolates task work from the repository that invoked it, while `DockerCommandWorker` executes every coding worker attempt in a separately constrained Docker container. The judge remains an adapter supplied by the caller.

`DockerGitWorkspace`:

1. It reads and records the source repository `HEAD` SHA.
2. It asks a disposable Docker container running as the invoking host UID/GID to clone that exact SHA into a host-temporary mounted directory. The clone is already an initialized Git repository.
3. After an unsuccessful judgment, it writes `attempt-N.patch` to a sibling temporary artifacts directory, hard-resets to the recorded baseline commit, and cleans untracked/ignored files before the next model runs.
4. Cleanup deletes the temporary workspace at the end of a run. The original working tree is read-only to the sandbox and is never reset or modified.

`DockerCommandWorker` mounts only that isolated workspace, drops Linux capabilities, enables `no-new-privileges`, limits process count, makes the container filesystem read-only apart from an in-memory `/tmp`, and disables network access by default. Set its `network` option to `bridge` explicitly only for a worker that needs an API connection. Its command receives JSON task context in `PARETO_TASK_CONTEXT` and must write one JSON `WorkerResult` object to stdout.

Build the sandbox image before constructing a `DockerGitWorkspace`:

```bash
docker build -f Dockerfile.task-sandbox -t pareto-task-sandbox:latest .
```

A task runner must arrange for its worker to execute inside the workspace identified by `WorkspaceInfo.workingDirectory`; this package deliberately does not embed a coding-provider API or task sandbox command.

## Owned Node model-matrix study

The repository also contains a self-contained, dependency-free Node repair suite under [`fixtures/own-harness-tasks/`](fixtures/own-harness-tasks/). It is a directional cost-and-resolution study, not a public benchmark or leaderboard score: every fixture is owned by this repository and uses an exact focused `node --test` regression.

The hash-bound tiers are:

- `single` — one smoke fixture;
- `lite` — four fast cost-comparison fixtures;
- `full` — all 13 owned fixtures.

Run a reproducible fixed-model matrix and the immutable Pareto policy end to end:

```bash
node scripts/run-owned-node-suite.mjs \
  --tier full \
  --models openai/gpt-5.6-luna,x-ai/grok-4.5,anthropic/claude-opus-4.6,qwen/qwen3-coder \
  --generic-turns 72 \
  --include-pareto \
  --max-task-cost-usd 9 \
  --max-total-cost-usd 75 \
  --output-dir runs/full-model-matrix-001
```

The runner validates the selected tier and its bound fixture-manifest hash before dispatch, uses fresh workspaces, requires authoritative OpenRouter `usage.cost`, and writes a run manifest plus Markdown, CSV, and JSON results. Fixed-model policies receive one continuous session of up to 72 model-response/tool-loop turns **per task**; Pareto retains its frozen nine-rung policy with up to eight turns per rung. Policies stop early after a passing deterministic regression, so actual turns and cost vary by task.

### Full-tier result — 2026-07-17

![Full-tier actual provider cost and resolution](reports/full-model-matrix-001/cost-chart.svg)

| Policy | Resolved | Actual provider cost |
|---|---:|---:|
| GPT-5.6 Luna — one 72-turn session | 12 / 13 | $0.797856 |
| Grok 4.5 — one 72-turn session | 13 / 13 | $1.368134 |
| Claude Opus 4.6 — one 72-turn session | 13 / 13 | $5.971770 |
| Qwen3 Coder — one 72-turn session | 6 / 13 | $1.164105 |
| Frozen Pareto | 13 / 13 | $0.106386 |

All 65 task-policy rows had complete provider-reported cost. The full report, chart source, CSV, JSON, and hash-bound run manifest are available in [`reports/full-model-matrix-001/`](reports/full-model-matrix-001/). These results are a single directional run on deliberately owned fixtures; they should not be generalized into claims about all coding tasks or model quality.

## Issues and project tracking

[GitHub Issues](https://github.com/frosty-agent/pareto-curve-agent-harness/issues) is the canonical tracker for this repository. Please open new bugs, feature requests, and implementation work there.

The unfinished work was migrated from the former Linear project on July 14, 2026:

- [#1 — Capture session, hooks, MCP, and tool trace in reports](https://github.com/frosty-agent/pareto-curve-agent-harness/issues/1) (from `AGE-10`)
- [#2 — Adopt fork as Docker coding-worker runtime](https://github.com/frosty-agent/pareto-curve-agent-harness/issues/2) (from `AGE-9`)
- [#3 — Run and evaluate OpenRouter Pareto agent ladder end-to-end](https://github.com/frosty-agent/pareto-curve-agent-harness/issues/3) (from `AGE-11`)

Each migrated issue links back to its Linear source for historical context. GitHub is authoritative for status and discussion going forward.

## Development

```bash
npm install
npm test
npm run build
npm run start -- --limit 10
```
