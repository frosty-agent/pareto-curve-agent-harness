import assert from "node:assert/strict";
import test from "node:test";

import { parseContentType } from "../src/content-type.js";

test("parses quoted parameter values containing semicolons", () => {
  assert.deepEqual(
    parseContentType('Text/HTML; charset="utf-8"; boundary="part;two"'),
    { type: "text/html", parameters: { charset: "utf-8", boundary: "part;two" } },
  );
});

test("unescapes quoted pairs and rejects unterminated quoted values", () => {
  assert.deepEqual(
    parseContentType('application/example; note="a\\\\b\\\"c"'),
    { type: "application/example", parameters: { note: 'a\\b"c' } },
  );
  assert.equal(parseContentType('text/plain; charset="utf-8'), null);
});
