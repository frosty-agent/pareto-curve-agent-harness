import assert from "node:assert/strict";
import test from "node:test";

import { NdjsonFramer } from "../src/framer.js";

test("frames JSON records split across arbitrary chunks", () => {
  const framer = new NdjsonFramer();

  assert.deepEqual(framer.push('{"id":1}\n{"id":'), [{ id: 1 }]);
  assert.deepEqual(framer.push('2}\n'), [{ id: 2 }]);
});

test("does not emit a final empty NDJSON line", () => {
  const framer = new NdjsonFramer();
  assert.deepEqual(framer.push('{"ok":true}\n\n'), [{ ok: true }]);
});
