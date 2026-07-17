import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs } from "../src/args.js";

test("treats tokens after double dash as positional", () => {
  assert.deepEqual(
    parseArgs(["serve", "--verbose", "--", "--literal", "-x"]),
    {
      options: { verbose: true },
      positionals: ["serve", "--literal", "-x"],
    },
  );
});

test("continues parsing options when no double dash is supplied", () => {
  assert.deepEqual(parseArgs(["serve", "-q"]), {
    options: { q: true },
    positionals: ["serve"],
  });
});
