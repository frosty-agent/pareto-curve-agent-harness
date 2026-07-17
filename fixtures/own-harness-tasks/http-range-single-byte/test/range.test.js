import assert from "node:assert/strict";
import test from "node:test";

import { createSingleRangeResponse } from "../src/range.js";

const body = Buffer.from("abcdef");

test("returns an inclusive single byte range", () => {
  const response = createSingleRangeResponse(body, "bytes=1-3");
  assert.equal(response.status, 206);
  assert.equal(response.headers["content-range"], "bytes 1-3/6");
  assert.equal(response.headers["content-length"], "3");
  assert.equal(response.body.toString(), "bcd");
});

test("supports suffix byte ranges", () => {
  const response = createSingleRangeResponse(body, "bytes=-2");
  assert.equal(response.status, 206);
  assert.equal(response.headers["content-range"], "bytes 4-5/6");
  assert.equal(response.body.toString(), "ef");
});

test("rejects multi-range and unsatisfiable requests", () => {
  for (const header of ["bytes=0-1,3-4", "bytes=9-10", "bytes=-0"]) {
    const response = createSingleRangeResponse(body, header);
    assert.equal(response.status, 416, header);
    assert.equal(response.headers["content-range"], "bytes */6", header);
    assert.equal(response.body.length, 0, header);
  }
});
