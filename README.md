# Pareto Curve Agent Harness

A small research harness for comparing **coding-agent policies** by deterministic task outcome and actual provider cost.

The current study uses owned, dependency-free Node repair fixtures. It is **directional evidence**, not a public leaderboard or a claim about all software-engineering tasks.

## How the policies differ

Both policies receive the same fixture baseline, task prompt, bounded tools, deterministic `node --test` regression, fresh workspace, and OpenRouter cost accounting. The policy—not the task contract—is what changes.

| Policy | Execution strategy |
|---|---|
| **Generic fixed-model harness** | Uses one selected model in a single continuous session of up to **72 model-response/tool-loop turns per task**. It stops early when the regression passes. |
| **Frozen Pareto ladder** | Tries the recorded nine-model order. Each rung gets up to **8 turns**; a failed rung is reset to the original baseline and the next rung receives bounded regression feedback. It has up to **72 turns per task** across the ladder and also stops early on a passing regression. |

The maximum per-task response envelope is therefore the same, but the trajectories are deliberately different: generic maintains one long context; Pareto uses bounded, resettable escalation across models.

## Full cost study

The latest full run evaluated 13 owned fixtures across four fixed models and the frozen Pareto policy. All 65 task-policy rows had complete provider-reported `usage.cost`.

![Full-tier actual provider cost and resolution](reports/full-model-matrix-001/cost-chart.svg)

| Policy | Resolved | Actual provider cost |
|---|---:|---:|
| GPT-5.6 Luna — one 72-turn session | 12 / 13 | $0.797856 |
| Grok 4.5 — one 72-turn session | 13 / 13 | $1.368134 |
| Claude Opus 4.6 — one 72-turn session | 13 / 13 | $5.971770 |
| Qwen3 Coder — one 72-turn session | 6 / 13 | $1.164105 |
| Frozen Pareto | 13 / 13 | $0.106386 |

On this single owned-fixture run, Pareto matched the strongest fixed-model resolution result at the lowest actual cost. That is a policy result for this suite—not a general model ranking.

The complete evidence is checked in:

- [full report](reports/full-model-matrix-001/REPORT.md)
- [cost chart](reports/full-model-matrix-001/cost-chart.svg)
- [CSV rows](reports/full-model-matrix-001/results.csv)
- [JSON rows](reports/full-model-matrix-001/results.json)
- [hash-bound run manifest](reports/full-model-matrix-001/run-manifest.json)

## Validate or run the current suite

The owned fixture tiers are `single` (1 task), `lite` (4 fast tasks), and `full` (13 tasks). Start with a no-cost validation run; the output directory must be new unless you use `--resume` with the exact same run manifest.

```bash
node scripts/run-owned-node-suite.mjs \
  --tier lite \
  --models openai/gpt-5.6-luna,x-ai/grok-4.5 \
  --generic-turns 72 \
  --include-pareto \
  --max-task-cost-usd 9 \
  --max-total-cost-usd 75 \
  --output-dir "/tmp/pareto-lite-dry-$(date +%s)" \
  --dry-run
```

See [documentation](docs/README.md) for command details, artifact contracts, the catalog CLI, legacy Docker ladder notes, and development instructions.
