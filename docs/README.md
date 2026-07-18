# Operating guide, experiment contract, and evidence

## Core runtime: `ParetoTaskLadder`

`ParetoTaskLadder` is the task-execution primitive. Its constructor receives a `TaskWorker`, a `TaskJudge`, and an `AttemptWorkspace`. A run receives a task plus the caller's ordered model ladder.

For each model, the runtime invokes the worker, sends the resulting attempt to the injected evaluator, and returns as soon as `JudgeResult.successful` is true. On rejection it snapshots the attempted change and resets the workspace before invoking the next model. The next worker receives the prior worker output, evaluator learnings, and snapshot reference. It returns `success`, `exhausted`, `execution_error`, or `judge_error`, and cleans the disposable workspace in every case.

`TaskJudge` is pluggable. The repository includes an OpenRouter judge adapter, but callers can implement deterministic checks, a model judge, or a composite evaluator. The runtime selects the highest-intelligence model in the supplied ladder as judge context; an evaluator adapter may use or ignore that context according to its own contract.

## Supporting validation: owned Node policy study

The current supported comparison path is the self-contained Node fixture suite. It has no Docker, Python, SWE-bench, or external task runtime dependency.

### Fixture and tier contract

- Fixture definitions: [`../fixtures/own-harness-tasks/manifest.json`](../fixtures/own-harness-tasks/manifest.json)
- Tier selection: [`../fixtures/own-harness-tasks/tiers.json`](../fixtures/own-harness-tasks/tiers.json)
- Fixtures intentionally fail at baseline. The runner validates the selected tier's hash-bound fixture manifest before a live run.
- `single` contains one smoke task; `lite` contains four fast tasks; `full` contains all 13 tasks.
- Fixed policies receive one continuous session of up to the selected turn count per task. The current study uses 72 turns.
- Pareto retains its frozen recorded nine-model order and permits up to eight turns per rung. It resets the workspace after each failed rung and provides bounded regression feedback to the next rung.
- Every policy gets the same prompt, production-only patch tool, regression command, fresh workspace, and provider-reported cost rule.

### Ladder execution contract

The fixed-model policy keeps one model, one workspace, and one conversation for up to the configured turn limit (72 in the checked-in matrix). The Pareto policy instead starts at rung one of its immutable nine-model list and gives each rung up to eight turns.

After a Pareto rung fails its exact regression, the runner records the attempt evidence, discards its candidate changes by hard-resetting to the baseline commit, and gives the next rung compact tail feedback from the failed regression. Only a passing regression with complete cost accounting accepts a patch; unavailable/malformed provider cost stops scoring rather than becoming zero cost. This reset-and-escalate loop is the key behavioral difference from a generic long-context harness.

### End-to-end suite runner

```bash
# No-provider-call validation
node scripts/run-owned-node-suite.mjs \
  --tier lite \
  --models openai/gpt-5.6-luna,x-ai/grok-4.5 \
  --generic-turns 72 \
  --include-pareto \
  --max-task-cost-usd 9 \
  --max-total-cost-usd 75 \
  --output-dir "/tmp/owned-node-lite-dry-$(date +%s)" \
  --dry-run

# Live run; OPENROUTER_API_KEY must be available in the environment
node scripts/run-owned-node-suite.mjs \
  --tier full \
  --models openai/gpt-5.6-luna,x-ai/grok-4.5,anthropic/claude-opus-4.6,qwen/qwen3-coder \
  --generic-turns 72 \
  --include-pareto \
  --max-task-cost-usd 9 \
  --max-total-cost-usd 75 \
  --output-dir "/tmp/owned-node-full-$(date +%s)"
```

Required suite arguments are `--tier`, `--models`, and `--output-dir`. Optional flags are `--include-pareto`, `--generic-turns`, `--max-task-cost-usd`, `--max-total-cost-usd`, `--tiers-manifest`, `--dry-run`, and `--resume`. `--resume` is valid only for an existing output directory whose stored scope, policies, turn limit, and caps exactly match the new invocation.

The output directory contains:

```text
run-manifest.json    # policy, tier, bound manifest hashes, limits, Node version
validation.json      # pre-dispatch tier/fixture validation
results.json         # complete matrix rows and aggregates
results.csv          # tabular matrix rows
REPORT.md            # compact human summary
tasks/               # isolated per-task/per-policy evidence
```

A result is scorable only when all provider calls report finite, non-negative `usage.cost`. Missing or malformed cost is never treated as free.

### Current evidence

- [Full 13-task matrix report](../reports/full-model-matrix-001/REPORT.md)
- [Full matrix CSV](../reports/full-model-matrix-001/results.csv)
- [Full matrix JSON](../reports/full-model-matrix-001/results.json)
- [Full matrix run manifest](../reports/full-model-matrix-001/run-manifest.json)
- [Fast four-task matrix report](../reports/lite-model-matrix-001/REPORT.md)

These are directional owned-fixture studies, not official SWE-bench or leaderboard results.

## OpenRouter catalog CLI

The catalog CLI derives a cost-vs-coding ladder from the OpenRouter Models API. It uses model IDs, token pricing, and embedded Artificial Analysis scores; it does not scrape the Pareto Router UI.

```bash
docker build -t pareto-curve-agent-harness .
docker run --rm pareto-curve-agent-harness \
  --input-tokens 10000 --output-tokens 2000 --limit 10 --exclude-preview
```

The public catalog request does not require credentials. When `OPENROUTER_API_KEY` is supplied, it is sent only as an OpenRouter authorization header and is never printed.

Useful policy controls:

```bash
docker run --rm pareto-curve-agent-harness \
  --allow-provider openai,anthropic,google \
  --require-tools \
  --exclude-preview
```

Eligible models require an AA Coding Index. The CLI removes dominated models (another eligible model is at least as capable and no more expensive), orders the strict frontier from lower to higher Coding Index, and marks any dominated fill model with `isParetoOptimal: false`.

## Legacy Docker task ladder

`scripts/run-ladder.sh`, `ParetoTaskLadder`, `DockerGitWorkspace`, and `DockerCommandWorker` are retained for the earlier Dockerized repository-task path. They are not the current owned Node matrix workflow.

```bash
docker build -f Dockerfile.runner -t pareto-runner:latest .
scripts/run-ladder.sh \
  --prompt 'Implement the requested feature and run the project checks.' \
  --source /path/to/target-repository \
  --reports /tmp/pareto-reports
```

That path bind-mounts source read-only, uses a disposable workspace, and writes JSON/HTML/patch evidence to `--reports`. See `scripts/run-ladder.sh --help` for its historical options.

## Archived SWE-bench notes

[`../evaluations/own-runner/README.md`](../evaluations/own-runner/README.md) describes an earlier Docker/SWE-bench-derived experimental path. It is historical only and should not be combined with the owned Node evidence or presented as an official SWE-bench result.

## Development

```bash
npm install
npm test
npm run build
npm run start -- --limit 10
```

GitHub Issues is the project tracker.
