import assert from "node:assert/strict";
import test from "node:test";

import { createConditionalFileResponse } from "../src/etag.js";

test("generates a quoted ETag and honors weak list matches", () => {
  const initial = createConditionalFileResponse("file body");
  assert.match(initial.headers.etag, /^"[a-f0-9]{64}"$/);

  const response = createConditionalFileResponse("file body", {
    ifNoneMatch: `"other", W/${initial.headers.etag}`,
  });
  assert.equal(response.status, 304);
  assert.equal(response.body.length, 0);
  assert.equal(response.headers.etag, initial.headers.etag);
});

test("returns no body for HEAD without treating a non-match as fresh", () => {
  const response = createConditionalFileResponse("file body", { method: "HEAD", ifNoneMatch: '"other"' });
  assert.equal(response.status, 200);
  assert.equal(response.body.length, 0);
});
