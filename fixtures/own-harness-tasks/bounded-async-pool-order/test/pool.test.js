import assert from "node:assert/strict";
import test from "node:test";

import { mapLimit } from "../src/pool.js";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("keeps result order while limiting concurrent mappers", async () => {
  let active = 0;
  let maximumActive = 0;

  const result = await mapLimit([30, 5, 10], 2, async (delay, index) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await sleep(delay);
    active -= 1;
    return `result-${index}`;
  });

  assert.equal(maximumActive, 2);
  assert.deepEqual(result, ["result-0", "result-1", "result-2"]);
});

test("passes each original value and index to the mapper", async () => {
  assert.deepEqual(
    await mapLimit(["a", "b"], 1, async (value, index) => `${index}:${value}`),
    ["0:a", "1:b"],
  );
});
