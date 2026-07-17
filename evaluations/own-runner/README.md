# Lightweight SWE-bench Verified comparison (own runner)

This is a **1–3 task directional benchmark**, not a SWE-bench leaderboard submission. It avoids Claw and does not invoke the official SWE-bench harness. It uses public SWE-bench Verified records and the corresponding prepared instance images only; the evaluator is a public regression command taken from each instance's `FAIL_TO_PASS` field.

## Frozen experiment

- Task list: [`verified-3.tasks.json`](verified-3.tasks.json), three deterministic public tasks.
- Dataset: `princeton-nlp/SWE-bench_Verified`, pinned to the revision in that file.
- Systems: `pareto` with the repository's fixed recorded nine-rung policy, and `fixed-openai-gpt-5.6-luna`.
- Same contract: identical prepared `/testbed` image, prompt, bounded tools, maximum turns, task deadline, command allowlist, and public test command. Only policy/model selection differs.
- Cost authority: persist OpenRouter SDK response `usage.cost` for **every** completion. Missing/invalid cost stops that task's billed policy and makes its comparison row unscorable; it is never `$0`.

Use a new dated run directory such as `evaluations/own-runner/runs/2026-07-17/`; do not overwrite a previous run.

## 1. Obtain data and images without the official harness

Export the three public dataset records to a local JSON file. Each record must retain at least `instance_id`, `base_commit`, `problem_statement`, `test_patch`, `FAIL_TO_PASS`, and `PASS_TO_PASS`. Pull/build the matching SWE-bench instance images by your normal dataset/image preparation path, then record their immutable local refs in a copied `images.json` (start from `images.example.json`). The bootstrapper deliberately fails if an image ref is still a placeholder.

> The script does **not** guess image names. Image naming changes between SWE-bench releases, so capture the exact image ref/ID actually prepared for each selected record.

Prepare testbeds, including the instance's public test patch:

```bash
cp evaluations/own-runner/images.example.json /secure/run/images.json
# Replace all three placeholder values with already-present instance image refs.
python3 scripts/bootstrap-own-swe-bench.py \
  --tasks evaluations/own-runner/verified-3.tasks.json \
  --dataset-export /secure/swe-bench-verified-export.json \
  --images /secure/run/images.json \
  --output evaluations/own-runner/runs/DATE/prepared
```

The result is `prepared/<instance-id>/testbed` plus `bootstrap.json`, recording the base SHA, test-patch SHA, manifest SHA, image ref, and image ID. The script copies `/testbed` from the image, verifies its Git `HEAD` is exactly `base_commit`, then applies `test_patch`. A mismatch deletes that testbed and fails closed.

For safe planning only, use `--dry-run`; it validates dataset/task/image mapping and makes no Docker calls.

## 2. Per-task contract

For each `testbed`, create a fresh clone/copy **per system**. Both systems receive:

```text
system: you are a repository repair agent. Work only in /testbed.
user: <record.problem_statement>
      Run the supplied public regression command before finalizing.
      Do not modify tests.
```

Expose the exact same constrained tools to both policies:

- `read_file(path)`, `list_files(path)`, `apply_patch(diff)`, and `run_command(command)`;
- `run_command` accepts only a task-derived allowlist: the public regression command plus narrowly needed repository status/diff and declared build/test commands;
- no unrestricted shell, credentials, or network access inside the task container.

Derive the regression command deterministically from the public record: parse `FAIL_TO_PASS` as its JSON list and execute the project test runner's listed node IDs after `test_patch` is applied. Store the exact command, exit code, and bounded stdout/stderr in `public-test.json`. Also run the public `PASS_TO_PASS` list when it is available and time permits, but keep it distinct from the primary regression verdict.

## 3. Policy runners

Use `runOpenRouterAgent` as the shared completion/tool loop:

- **Fixed baseline:** invoke once with `openai/gpt-5.6-luna`.
- **Pareto:** invoke the same loop with each rung of `FROZEN_PARETO_LADDER_IDS`, preserving its order and the existing worker/judge/reset escalation. A rejected rung writes its diff, resets to the checked base testbed, then continues. Do not reduce, reorder, or substitute the nine rungs.

Set identical `maxTurns`, task deadline, per-task dollar cap, and a host-owned total cap before either system starts. Freeze and hash the task manifest, prompt/template version, tool schema/allowlist, model ladder, image ID, and dataset export before a paid run.

For every OpenRouter call, append a `calls.jsonl` row from `OpenRouterCallRecord`: model, response ID, token counts, duration, `actualCostUsd`, and `costAccountingComplete`. Sum only complete costs. Store attempts, accepted patch SHA, public test output, and the final decision beside each task/system. Never run public tests or collect a final patch from an unaccepted/rejected Pareto rung.

## 4. Scoring and compact results

The public regression result is the only outcome for this own-runner comparison:

- `resolved`: selected `FAIL_TO_PASS` command exits 0 on the final accepted patch;
- `unresolved`: it exits nonzero;
- `error`/`not_run`: runner or test infrastructure failed.

This is not equivalent to official SWE-bench resolution. Do **not** upload it as a SWE-bench prediction or compare it to leaderboard scores.

Create `run-results.json` with one row for each task/system (schema follows `results.example.json`) and write paired results:

```bash
npx tsx src/own-benchmark-report-cli.ts \
  --input evaluations/own-runner/runs/DATE/run-results.json \
  --markdown evaluations/own-runner/runs/DATE/RESULTS.md \
  --csv evaluations/own-runner/runs/DATE/results.csv
```

The report scores only tasks that have both policy rows, a public `resolved`/`unresolved` verdict, and complete actual cost. Incomplete/missing-cost or infrastructure rows remain in the CSV audit trail but are excluded from pass-rate and cost-per-resolved denominators.

## Preflight checklist

1. Confirm all image IDs and commits in `bootstrap.json`.
2. Freeze and SHA-256 the records export, task list, prompt, tool policy, and nine-rung ladder.
3. Confirm each system receives the same copied baseline and deadline.
4. Confirm every `calls.jsonl` record has `usage.cost` before billing aggregates.
5. Verify `RESULTS.md` and `results.csv` were generated from the final `run-results.json`.
