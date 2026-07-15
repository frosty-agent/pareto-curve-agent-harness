"""Executable contract tests for the vendorable Claw-SWE-Bench adapter."""

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path


ADAPTER_PATH = Path(__file__).with_name("pareto.py")


class FakeBaseClawAdapter:
    def __init__(self, model, timeout, max_turns=None):
        self.model = model
        self.timeout = timeout
        self.max_turns = max_turns


class FakeAgentResult:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


def load_adapter(
    runtime: Path,
    node_bin: str | None = "/usr/bin/node",
    ladder_path: Path | None = None,
    task_cost_cap_usd: str | None = None,
):
    base_module = types.ModuleType("claw_swebench.claws.base")
    base_module.BaseClawAdapter = FakeBaseClawAdapter
    base_module.decode_output = lambda value: value.decode() if isinstance(value, bytes) else value or ""
    types_module = types.ModuleType("claw_swebench.types")
    types_module.AgentResult = FakeAgentResult
    package = types.ModuleType("claw_swebench")
    claws = types.ModuleType("claw_swebench.claws")
    previous = {name: sys.modules.get(name) for name in ("claw_swebench", "claw_swebench.claws", "claw_swebench.claws.base", "claw_swebench.types")}
    sys.modules.update({
        "claw_swebench": package,
        "claw_swebench.claws": claws,
        "claw_swebench.claws.base": base_module,
        "claw_swebench.types": types_module,
    })
    old_runtime = os.environ.get("PARETO_RUNTIME_DIR")
    old_node = os.environ.get("PARETO_NODE_BIN")
    old_ladder = os.environ.get("PARETO_LADDER_PATH")
    old_cap = os.environ.get("PARETO_TASK_COST_CAP_USD")
    os.environ["PARETO_RUNTIME_DIR"] = str(runtime)
    if node_bin is None:
        os.environ.pop("PARETO_NODE_BIN", None)
    else:
        os.environ["PARETO_NODE_BIN"] = node_bin
    if ladder_path is None:
        os.environ.pop("PARETO_LADDER_PATH", None)
    else:
        os.environ["PARETO_LADDER_PATH"] = str(ladder_path)
    if task_cost_cap_usd is None:
        os.environ.pop("PARETO_TASK_COST_CAP_USD", None)
    else:
        os.environ["PARETO_TASK_COST_CAP_USD"] = task_cost_cap_usd
    spec = importlib.util.spec_from_file_location("pareto_adapter_under_test", ADAPTER_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)

    def cleanup():
        for name, prior in previous.items():
            if prior is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = prior
        if old_runtime is None:
            os.environ.pop("PARETO_RUNTIME_DIR", None)
        else:
            os.environ["PARETO_RUNTIME_DIR"] = old_runtime
        if old_node is None:
            os.environ.pop("PARETO_NODE_BIN", None)
        else:
            os.environ["PARETO_NODE_BIN"] = old_node
        if old_ladder is None:
            os.environ.pop("PARETO_LADDER_PATH", None)
        else:
            os.environ["PARETO_LADDER_PATH"] = old_ladder
        if old_cap is None:
            os.environ.pop("PARETO_TASK_COST_CAP_USD", None)
        else:
            os.environ["PARETO_TASK_COST_CAP_USD"] = old_cap

    return module, cleanup


class ParetoAdapterTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original_api_key = os.environ.get("OPENROUTER_API_KEY")
        os.environ["OPENROUTER_API_KEY"] = "unit-test-key"
        self.runtime = Path(self.temp.name) / "runtime"
        (self.runtime / "node_modules" / "@openrouter" / "sdk").mkdir(parents=True)
        (self.runtime / "openrouter-worker.mjs").write_text("// fixture\n")
        (self.runtime / "openrouter-ladder-worker.mjs").write_text("// fixture\n")
        self.module, self.cleanup_module = load_adapter(self.runtime)

    def tearDown(self):
        self.cleanup_module()
        if self.original_api_key is None:
            os.environ.pop("OPENROUTER_API_KEY", None)
        else:
            os.environ["OPENROUTER_API_KEY"] = self.original_api_key
        self.temp.cleanup()

    def test_defaults_node_path_from_the_host_environment(self):
        module, cleanup = load_adapter(self.runtime, node_bin=None)
        try:
            self.assertEqual(module.PARETO_NODE_BIN, shutil.which("node"))
        finally:
            cleanup()

    def test_loads_dynamic_ladder_from_recorded_catalog_snapshot(self):
        snapshot = Path(self.temp.name) / "catalog.json"
        snapshot.write_text(json.dumps({"models": [
            {"id": "cheap/model", "codingIndex": 50, "intelligenceIndex": 40},
            {"id": "strong/model", "codingIndex": 80, "intelligenceIndex": 70},
        ]}))
        module, cleanup = load_adapter(self.runtime, ladder_path=snapshot, task_cost_cap_usd="1.0")
        try:
            adapter = module.ParetoAdapter("fallback/model", timeout=30, max_turns=7)
            self.assertEqual([model["id"] for model in adapter.ladder], ["cheap/model", "strong/model"])
            calls = []
            module.subprocess.run = lambda command, **kwargs: calls.append(command) or types.SimpleNamespace(returncode=0, stdout=json.dumps({"status": "completed", "output": "done"}), stderr="")
            adapter.send_task("fix it", "agent", "instance-container", None, "demo__ladder")
            self.assertIn('"id":"cheap/model"', " ".join(calls[0]))
            self.assertIn(module.PARETO_LADDER_WORKER_PATH, calls[0])
            self.assertIn("PARETO_TASK_COST_CAP_USD=1.0", calls[0])
        finally:
            cleanup()

    def test_runs_worker_in_testbed_with_configured_turn_and_timeout_limits(self):
        adapter = self.module.ParetoAdapter("vendor/model", timeout=30, max_turns=7)
        self.assertIn("/opt/pareto:ro", " ".join(adapter.container_run_args("demo__1")))
        calls = []

        def run(command, **kwargs):
            calls.append((command, kwargs))
            return types.SimpleNamespace(returncode=0, stdout=json.dumps({"status": "completed", "output": "done", "usage": {"costUsd": 0.02}}), stderr="")

        self.module.subprocess.run = run
        artifacts = Path(self.temp.name) / "artifacts"
        result = adapter.send_task("fix it", "agent", "instance-container", artifacts, "demo__1")

        command = calls[0][0]
        self.assertIn("PARETO_WORKSPACE=/testbed", command)
        self.assertIn("PARETO_MAX_TOOL_ROUNDS=7", command)
        self.assertIn("timeout", command)
        self.assertIn("--signal=KILL", command)
        self.assertTrue(result.success)
        self.assertEqual(adapter.collect_usage(types.SimpleNamespace(instance_id="demo__1"), artifacts), {"costUsd": 0.02})
        self.assertTrue((artifacts / "pareto-worker-result.json").is_file())

    def test_kills_worker_inside_container_when_docker_exec_client_times_out(self):
        adapter = self.module.ParetoAdapter("vendor/model", timeout=1, max_turns=2)
        calls = []

        def run(command, **kwargs):
            calls.append((command, kwargs))
            if len(calls) == 1:
                raise subprocess.TimeoutExpired(command, 1, output="", stderr="late")
            return types.SimpleNamespace(returncode=0, stdout="", stderr="")

        self.module.subprocess.run = run
        result = adapter.send_task("fix it", "agent", "instance-container", None, "demo__timeout")

        self.assertTrue(result.timeout)
        self.assertGreaterEqual(len(calls), 2)
        self.assertEqual(calls[1][0][:4], ["docker", "exec", "instance-container", "pkill"])


if __name__ == "__main__":
    unittest.main()
