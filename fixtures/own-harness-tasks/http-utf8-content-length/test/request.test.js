import assert from "node:assert/strict";
import test from "node:test";

import { createRequest } from "../src/request.js";

test("uses UTF-8 byte length for a non-ASCII body", () => {
  const request = createRequest("price=€");

  assert.equal(request.headers["content-length"], "9");
  assert.equal(request.body, "price=€");
});

test("keeps the ASCII body length unchanged", () => {
  assert.equal(createRequest("ok").headers["content-length"], "2");
});
