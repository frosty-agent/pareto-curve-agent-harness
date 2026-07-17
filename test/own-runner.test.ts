import assert from "node:assert/strict";
import test from "node:test";

import { FIXED_BASELINE_MODEL, derivePublicRegressionCommand, modelsForSystem, parsePreparedTask } from "../src/own-runner.js";

const record = {
  instance_id: "django__django-11790", base_commit: "a", problem_statement: "fix it", test_patch: "diff",
  FAIL_TO_PASS: JSON.stringify([
    "test_one (auth_tests.test_forms.AuthenticationFormTest)",
    "test_two (auth_tests.test_forms.AuthenticationFormTest)",
  ]),
};

test("parses a selected public task and derives exact no-shell Django regression argv", () => {
  const parsed = parsePreparedTask([record], record.instance_id);
  assert.deepEqual(derivePublicRegressionCommand(parsed), {
    command: "/opt/miniconda3/envs/testbed/bin/python tests/runtests.py auth_tests.test_forms.AuthenticationFormTest.test_one auth_tests.test_forms.AuthenticationFormTest.test_two",
    argv: ["/opt/miniconda3/envs/testbed/bin/python", "tests/runtests.py", "auth_tests.test_forms.AuthenticationFormTest.test_one", "auth_tests.test_forms.AuthenticationFormTest.test_two"],
  });
});

test("derives Sphinx pytest argv and keeps fixed/Pareto model policy immutable", () => {
  const sphinx = { ...record, instance_id: "sphinx-doc__sphinx-10323", FAIL_TO_PASS: JSON.stringify(["tests/test_x.py::test_x"]) };
  assert.deepEqual(derivePublicRegressionCommand(sphinx), { command: "/opt/miniconda3/envs/testbed/bin/python -m pytest tests/test_x.py::test_x", argv: ["/opt/miniconda3/envs/testbed/bin/python", "-m", "pytest", "tests/test_x.py::test_x"] });
  const flask = { ...record, instance_id: "pallets__flask-5014", FAIL_TO_PASS: JSON.stringify(["tests/test_blueprints.py::test_empty_name_not_allowed"]) };
  assert.deepEqual(derivePublicRegressionCommand(flask), { command: "/opt/miniconda3/envs/testbed/bin/pytest -rA tests/test_blueprints.py::test_empty_name_not_allowed", argv: ["/opt/miniconda3/envs/testbed/bin/pytest", "-rA", "tests/test_blueprints.py::test_empty_name_not_allowed"] });
  assert.deepEqual(modelsForSystem("fixed-openai-gpt-5.6-luna"), [FIXED_BASELINE_MODEL]);
  assert.equal(modelsForSystem("pareto").length, 9);
  assert.throws(() => parsePreparedTask([record], "missing"), /absent/);
});
