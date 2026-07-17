import assert from "node:assert/strict";
import test from "node:test";

import { createDockerTestRuntime } from "../src/docker-test-runtime.js";
import { createOwnRunnerTools, type CommandSpec } from "../src/own-runner.js";

const imageId = "sha256:ffa7af7191f8aca58cc00db4582c7b0cb1aab91d395dc470baeac8cd7a5758ee";
const regression: CommandSpec = {
  command: "pytest -rA tests/test_blueprints.py::test_empty_name_not_allowed",
  argv: ["pytest", "-rA", "tests/test_blueprints.py::test_empty_name_not_allowed"],
};

function runCommand(command: string) {
  return { id: "call-1", type: "function" as const, function: { name: "run_command", arguments: JSON.stringify({ command }) } };
}

test("runs the immutable regression in the pinned image with Docker argv and no shell", async () => {
  const calls: Array<{ argv: readonly string[]; timeoutMs: number; maxBuffer: number }> = [];
  const runtime = createDockerTestRuntime({
    workspace: "/tmp/owned testbed",
    imageId,
    regression,
    timeoutMs: 4_321,
    outputLimit: 12,
    executor: async (argv, options) => {
      calls.push({ argv, timeoutMs: options.timeoutMs, maxBuffer: options.maxBuffer });
      return { exitCode: 0, stdout: "123456789012345", stderr: "" };
    },
  });

  const result = await runtime.run(new AbortController().signal);

  assert.deepEqual(calls, [{
    argv: [
      "run", "--rm", "--network", "none",
      "--mount", "type=bind,src=/tmp/owned testbed,dst=/testbed",
      "--workdir", "/testbed", imageId,
      "pytest", "-rA", "tests/test_blueprints.py::test_empty_name_not_allowed",
    ],
    timeoutMs: 4_321,
    maxBuffer: 12,
  }]);
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /^123456789012/);
  assert.match(result.output, /\[output truncated\]/);
  assert.equal(calls[0]!.argv.some((part) => ["bash", "sh", "-c", "-lc"].includes(part)), false);
});

test("own runner rejects every command except the immutable regression and delegates it to Docker", async () => {
  const calls: Array<readonly string[]> = [];
  const runtime = createDockerTestRuntime({
    workspace: "/tmp/testbed",
    imageId,
    regression,
    executor: async (argv) => {
      calls.push(argv);
      return { exitCode: 1, stdout: "failed", stderr: "details" };
    },
  });
  const tools = createOwnRunnerTools("/tmp/testbed", regression, 4, runtime);
  const signal = new AbortController().signal;

  assert.deepEqual(await tools.execute(runCommand("git status --short"), signal), { content: "Command is not allowlisted", isError: true });
  assert.deepEqual(await tools.execute(runCommand(regression.command), signal), { content: "failed\ndetails", isError: true });
  assert.deepEqual(calls, [[
    "run", "--rm", "--network", "none",
    "--mount", "type=bind,src=/tmp/testbed,dst=/testbed",
    "--workdir", "/testbed", imageId,
    ...regression.argv,
  ]]);
});

test("fails closed when Docker execution reports a timeout or the runtime is absent", async () => {
  const runtime = createDockerTestRuntime({
    workspace: "/tmp/testbed",
    imageId,
    regression,
    executor: async () => ({ exitCode: null, stdout: "", stderr: "", timedOut: true }),
  });
  const signal = new AbortController().signal;
  const tools = createOwnRunnerTools("/tmp/testbed", regression, 4, runtime);

  assert.deepEqual(await tools.execute(runCommand(regression.command), signal), { content: "Command timed out", isError: true });
  assert.deepEqual(await createOwnRunnerTools("/tmp/testbed", regression).execute(runCommand(regression.command), signal), { content: "Docker test runtime is required", isError: true });
  const otherRegression = { command: "python -c pass", argv: ["python", "-c", "pass"] };
  const mismatchedRuntime = createDockerTestRuntime({ workspace: "/tmp/testbed", imageId, regression: otherRegression, executor: async () => ({ exitCode: 0, stdout: "", stderr: "" }) });
  assert.deepEqual(await createOwnRunnerTools("/tmp/testbed", regression, 4, mismatchedRuntime).execute(runCommand(regression.command), signal), { content: "Docker test runtime does not match allowed regression", isError: true });
  assert.throws(() => createDockerTestRuntime({ workspace: "/tmp/testbed", imageId: "mutable:image", regression }), /immutable image ID/);
});
