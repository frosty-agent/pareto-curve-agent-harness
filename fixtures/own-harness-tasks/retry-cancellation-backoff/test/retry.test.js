import assert from "node:assert/strict";
import test from "node:test";

import { retry } from "../src/retry.js";

test("does not start an operation when the signal is already cancelled", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled before retry"));
  let calls = 0;

  await assert.rejects(
    retry(async () => { calls += 1; }, { signal: controller.signal }),
    /cancelled before retry/,
  );
  assert.equal(calls, 0);
});

test("stops retrying when cancellation happens during backoff", async () => {
  const controller = new AbortController();
  let calls = 0;
  let delays = 0;

  await assert.rejects(
    retry(
      async () => {
        calls += 1;
        throw new Error("temporary failure");
      },
      {
        attempts: 3,
        signal: controller.signal,
        delay: async () => {
          delays += 1;
          controller.abort(new Error("cancelled during backoff"));
        },
      },
    ),
    /cancelled during backoff/,
  );

  assert.equal(calls, 1);
  assert.equal(delays, 1);
});
