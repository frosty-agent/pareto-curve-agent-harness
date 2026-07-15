# Claw-SWE-Bench integration (initial adapter)

`pareto.py` is a Claw-SWE-Bench `BaseClawAdapter` that runs Pareto's existing
OpenRouter tool loop inside the prepared SWE-bench instance container. The
Claw-SWE-Bench orchestrator remains authoritative for workspace preparation,
future-commit removal, runner-side patch collection, prediction creation, and
official evaluator invocation.

## What this initial slice verifies

- Pareto's runtime can be bind-mounted read-only into a Claw-SWE-Bench instance.
- The worker receives the standard Claw-SWE-Bench prompt and operates in
  `/testbed`, not Pareto's normal `/workspace` mount.
- Claw-SWE-Bench's `max_turns` is forwarded as `PARETO_MAX_TOOL_ROUNDS`; the
  worker defaults to 12 rounds only when no positive limit is configured.
- Each worker process is wrapped by the container's `timeout` command. If the
  Docker exec client itself times out, the adapter explicitly kills the worker
  process in the instance container before recording the timeout.
- The adapter saves worker stdout, stderr, and parsed worker JSON alongside the
  Claw-SWE-Bench patch and metadata artifacts.
- Worker usage is returned through `collect_usage()` for the benchmark's
  `metadata.json`.

## Install into a Claw-SWE-Bench checkout

```bash
cp integrations/claw-swe-bench/pareto.py \
  /path/to/claw-swe-bench/claw_swebench/claws/pareto.py
```

Then register `ParetoAdapter` in that checkout's
`claw_swebench/claws/__init__.py` and add a `pareto` entry to its
`CLAW_DEFAULTS`. Set the following **on the host running Claw-SWE-Bench**:

```bash
export PARETO_RUNTIME_DIR=/path/to/pareto-curve-agent-harness
export PARETO_NODE_BIN="$(command -v node)"
export OPENROUTER_API_KEY=... # do not put this in the image or artifacts
```

`PARETO_RUNTIME_DIR` must contain `openrouter-worker.mjs` and its installed
`node_modules/@openrouter/sdk` dependency. The adapter checks those paths
before the benchmark container starts.

## Current boundary

This is an adapter/provenance slice, not a completed SWE-bench evaluation.
The existing Pareto worker's `run_check` tool has a Node-only command allowlist
(`npm test`, `npm run build`, and Git inspection). Most SWE-bench instances
require language- and instance-specific test commands. The next implementation
slice must add a narrow, explicit validation-command policy for the selected
smoke instances while retaining `/testbed` containment and avoiding arbitrary
host command execution.
