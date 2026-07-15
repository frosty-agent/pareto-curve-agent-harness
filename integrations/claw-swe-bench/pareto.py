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
import subprocess
import time
from pathlib import Path

from claw_swebench.claws.base import BaseClawAdapter, decode_output
from claw_swebench.types import AgentResult


PARETO_RUNTIME_DIR = Path(os.environ.get("PARETO_RUNTIME_DIR", ".")).resolve()
PARETO_NODE_BIN = os.environ.get("PARETO_NODE_BIN", "/usr/bin/node")
PARETO_WORKER_PATH = "/opt/pareto/openrouter-worker.mjs"
SUBPROCESS_TIMEOUT_BUFFER = 120


class ParetoAdapter(BaseClawAdapter):
    """Run Pareto's OpenRouter tool loop inside a prepared SWE-bench container."""

    name = "pareto"

    def __init__(self, model: str, timeout: int, max_turns: int | None = None):
        super().__init__(model, timeout, max_turns)
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

        context = {
            "task": {"id": instance_id, "prompt": prompt},
            "model": {"id": self.model, "codingIndex": 0, "intelligenceIndex": None},
            "previousAttempt": None,
        }
        turn_limit = self.max_turns if self.max_turns and self.max_turns > 0 else 12
        command = [
            "docker", "exec",
            "-e", "PARETO_WORKSPACE=/testbed",
            "-e", f"PARETO_MAX_TOOL_ROUNDS={turn_limit}",
            "-e", f"PARETO_TASK_CONTEXT={json.dumps(context, separators=(',', ':'))}",
        ]
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if api_key:
            command.extend(["-e", f"OPENROUTER_API_KEY={api_key}"])
        command.extend([
            container_name,
            "timeout", "--signal=KILL", f"{self.timeout}s",
            PARETO_NODE_BIN, PARETO_WORKER_PATH,
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
