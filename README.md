# Pareto Ladder Harness

A coding-task harness that starts with a cheaper model, evaluates its attempt, and escalates through an ordered model ladder only when the task is not accepted.

## What the harness does

A caller supplies a task, an ordered ladder of worker models, a workspace implementation, and a **pluggable evaluator**. The evaluator can combine deterministic checks, a model judge, or both.

```text
clean task workspace
        │
        ▼
worker at rung 1 ──► evaluator ──accepted──► return accepted result
        │
     rejected
        │
        ▼
snapshot evidence + reset workspace to baseline
        │
        ▼
worker at rung 2 ──► evaluator ──accepted──► return accepted result
        │
       ...
        ▼
return exhausted / execution error / judge error
```

The ladder does not assume that the first model can solve every task. It pays for a cheaper attempt first, preserves evidence about a rejected attempt, restores the original workspace, gives bounded feedback to the next rung, and stops as soon as an evaluator accepts an attempt.

## How the ladder works

For each rung, `ParetoTaskLadder`:

1. gives the worker the task, a clean isolated workspace, and—after the first rung—the prior attempt's result, evaluator feedback, and snapshot reference;
2. records the worker result;
3. calls the configured `TaskJudge` evaluator;
4. returns immediately when the evaluator marks the attempt successful;
5. otherwise snapshots the rejected change and resets the workspace to its baseline before trying the next rung.

The ladder is ordered by the caller. A cost-aware caller normally puts lower-cost candidates first and more capable candidates later, but the harness preserves whatever explicit order it receives. It rejects duplicate model IDs and always cleans up the disposable workspace when the run ends.

## Pareto ladder vs. a generic harness

| Generic harness | Pareto ladder harness |
|---|---|
| One worker model gets one continuous attempt. | Multiple worker models are tried in an explicit order. |
| Context and workspace edits accumulate inside that attempt. | Every rejected rung is snapshotted, then the workspace resets to baseline. |
| A failure consumes more turns from the same model. | A rejection can carry bounded feedback to a fresh attempt by the next model. |
| The caller decides whether to retry externally. | Escalation, evidence capture, reset, and termination are part of the harness. |

This is a **task-execution harness**, not a benchmark harness. The owned Node model matrix in this repository is only one way to exercise and validate its cost-aware escalation behavior.

## Supporting cost evidence

The checked-in 13-task owned-Node run is supporting evidence, not the product description. With the study's frozen nine-rung configuration, Pareto resolved 13/13 fixtures at $0.106386 in provider-reported cost; the complete comparison, inputs, and limitations are in the linked artifacts.

![Full-tier actual provider cost and resolution](reports/full-model-matrix-001/cost-chart.svg)

- [full report](reports/full-model-matrix-001/REPORT.md)
- [CSV results](reports/full-model-matrix-001/results.csv)
- [JSON results](reports/full-model-matrix-001/results.json)
- [run manifest](reports/full-model-matrix-001/run-manifest.json)

## Use and implementation details

See the [operating guide](docs/README.md) for the runtime interfaces, Docker runner, owned Node suite, artifact contract, catalog CLI, and development commands.
