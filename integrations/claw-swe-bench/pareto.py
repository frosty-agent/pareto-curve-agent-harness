"""Pareto Curve Agent Harness adapter for Claw-SWE-Bench.

Install this file as ``claw_swebench/claws/pareto.py`` in a Claw-SWE-Bench
checkout, register ``ParetoAdapter`` in ``claw_swebench/claws/__init__.py``,
and point ``PARETO_RUNTIME_DIR`` at a built Pareto checkout containing
``openrouter-worker.mjs`` and ``node_modules/@openrouter/sdk``.

The Claw-SWE-Bench orchestrator owns the SWE-bench container and captures the
patch. This adapter only mounts the Pareto runtime, runs the worker in the
prepared /testbed workspace, and preserves the structured worker response.
"""

import json
import os
import shutil
import subprocess
import time
from pathlib import Path

from claw_swebench.claws.base import BaseClawAdapter, decode_output
from claw_swebench.types import AgentResult


PARETO_RUNTIME_DIR = Path(os.environ.get("PARETO_RUNTIME_DIR", ".")).resolve()
PARETO_NODE_BIN = os.environ.get("PARETO_NODE_BIN") or shutil.which("node") or "/usr/bin/node"
PARETO_WORKER_PATH = "/opt/pareto/openrouter-worker.mjs"
PARETO_LADDER_WORKER_PATH = "/opt/pareto/openrouter-ladder-worker.mjs"
SUBPROCESS_TIMEOUT_BUFFER = 120


def load_ladder(fallback_model: str) -> list[dict]:
    """Load the pre-recorded Pareto ladder, or use the explicit fallback model."""
    ladder_path = os.environ.get("PARETO_LADDER_PATH")
    if not ladder_path:
        return [{"id": fallback_model, "codingIndex": 0, "intelligenceIndex": None}]
    try:
        payload = json.loads(Path(ladder_path).read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Unable to load PARETO_LADDER_PATH={ladder_path}: {error}") from error
    models = payload.get("models") if isinstance(payload, dict) else payload
    if not isinstance(models, list) or not models:
        raise RuntimeError("Recorded Pareto ladder must contain a non-empty models array")
    ladder = [model for model in models if isinstance(model, dict) and isinstance(model.get("id"), str)]
    if len(ladder) != len(models):
        raise RuntimeError("Recorded Pareto ladder contains a model without an id")
    return ladder


class ParetoAdapter(BaseClawAdapter):
    """Run Pareto's OpenRouter tool loop inside a prepared SWE-bench container."""

    name = "pareto"

    def __init__(self, model: str, timeout: int, max_turns: int | None = None):
        super().__init__(model, timeout, max_turns)
        self.ladder = load_ladder(model)
        self.dynamic_ladder = bool(os.environ.get("PARETO_LADDER_PATH"))
        self.task_cost_cap_usd = float(os.environ.get("PARETO_TASK_COST_CAP_USD", "0"))
        self.judge_model = max(
            self.ladder,
            key=lambda candidate: candidate.get("intelligenceIndex") if isinstance(candidate.get("intelligenceIndex"), (int, float)) else -1,
        )["id"]
        if self.dynamic_ladder and self.task_cost_cap_usd <= 0:
            raise RuntimeError("PARETO_TASK_COST_CAP_USD must be positive for a dynamic ladder")
        self._usage_by_instance: dict[str, dict] = {}

    def container_run_args(self, instance_id: str) -> list[str]:
        if not (PARETO_RUNTIME_DIR / "openrouter-worker.mjs").is_file():
            raise RuntimeError(
                "PARETO_RUNTIME_DIR must contain openrouter-worker.mjs; "
                f"got {PARETO_RUNTIME_DIR}"
            )
        if not (PARETO_RUNTIME_DIR / "node_modules" / "@openrouter" / "sdk").exists():
            raise RuntimeError(
                "PARETO_RUNTIME_DIR must include installed @openrouter/sdk dependencies"
            )
        if self.dynamic_ladder and not (PARETO_RUNTIME_DIR / "openrouter-ladder-worker.mjs").is_file():
            raise RuntimeError("PARETO_RUNTIME_DIR must contain openrouter-ladder-worker.mjs for a dynamic ladder")
        return [
            "-v", f"{PARETO_RUNTIME_DIR}:/opt/pareto:ro",
            "-v", f"{PARETO_NODE_BIN}:{PARETO_NODE_BIN}:ro",
        ]

    def send_task(
        self,
        prompt: str,
        agent_id: str,
        container_name: str,
        artifact_dir: Path | None = None,
        instance_id: str | None = None,
    ) -> AgentResult:
        if not instance_id:
            raise ValueError("ParetoAdapter requires instance_id for artifact accounting")
        if artifact_dir:
            artifact_dir.mkdir(parents=True, exist_ok=True)

        selected_model = self.ladder[0]
        context = {
            "task": {"id": instance_id, "prompt": prompt},
            "model": {
                "id": selected_model["id"],
                "codingIndex": selected_model.get("codingIndex", 0),
                "intelligenceIndex": selected_model.get("intelligenceIndex"),
            },
            "previousAttempt": None,
        }
        turn_limit = self.max_turns if self.max_turns and self.max_turns > 0 else 12
        command = [
            "docker", "exec",
            "-e", "PARETO_WORKSPACE=/testbed",
            "-e", f"PARETO_MAX_TOOL_ROUNDS={turn_limit}",
            "-e", f"PARETO_TASK_CONTEXT={json.dumps(context, separators=(',', ':'))}",
        ]
        if self.dynamic_ladder:
            command.extend([
                "-e", f"PARETO_LADDER_JSON={json.dumps(self.ladder, separators=(',', ':'))}",
                "-e", f"PARETO_JUDGE_MODEL={self.judge_model}",
                "-e", f"PARETO_TASK_COST_CAP_USD={self.task_cost_cap_usd}",
            ])
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if api_key:
            command.extend(["-e", f"OPENROUTER_API_KEY={api_key}"])
        command.extend([
            container_name,
            "timeout", "--signal=KILL", f"{self.timeout}s",
            PARETO_NODE_BIN,
            PARETO_LADDER_WORKER_PATH if self.dynamic_ladder else PARETO_WORKER_PATH,
        ])

        started = time.time()
        timed_out = False
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=self.timeout + SUBPROCESS_TIMEOUT_BUFFER,
            )
            exit_code = result.returncode
            stdout = result.stdout
            stderr = result.stderr
            timed_out = exit_code in {124, 137}
        except subprocess.TimeoutExpired as error:
            timed_out = True
            exit_code = -1
            stdout = decode_output(error.stdout)
            stderr = decode_output(error.stderr)
            termination = subprocess.run(
                ["docker", "exec", container_name, "pkill", "-KILL", "-f", "[o]penrouter-worker.mjs"],
                capture_output=True,
                text=True,
                timeout=15,
            )
            if termination.returncode != 0:
                stderr = f"{stderr}\nFailed to terminate timed-out Pareto worker: {termination.stderr}".strip()

        parsed: dict = {}
        try:
            parsed = json.loads(stdout) if stdout.strip() else {}
        except json.JSONDecodeError:
            stderr = f"{stderr}\nPareto worker emitted invalid JSON".strip()

        if artifact_dir:
            (artifact_dir / "agent_stdout.log").write_text(stdout)
            (artifact_dir / "agent_stderr.log").write_text(stderr)
            (artifact_dir / "pareto-worker-result.json").write_text(
                json.dumps(parsed, indent=2, ensure_ascii=False) + "\n"
            )

        usage = parsed.get("usage") if isinstance(parsed.get("usage"), dict) else {}
        self._usage_by_instance[instance_id] = usage
        worker_completed = parsed.get("status") == "completed"
        if timed_out:
            finish_reason = "timeout"
        elif exit_code != 0 or not worker_completed:
            finish_reason = "error"
        else:
            finish_reason = "stop"
        return AgentResult(
            success=finish_reason == "stop",
            timeout=timed_out,
            exit_code=exit_code,
            finish_reason=finish_reason,
            stdout_path=artifact_dir / "agent_stdout.log" if artifact_dir else None,
            stderr_path=artifact_dir / "agent_stderr.log" if artifact_dir else None,
            session_id=None,
            duration_seconds=round(time.time() - started, 1),
            usage=usage,
        )

    def collect_usage(self, workspace, artifact_dir: Path) -> dict:
        return self._usage_by_instance.pop(workspace.instance_id, {})
