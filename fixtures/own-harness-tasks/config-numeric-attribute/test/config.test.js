import assert from "node:assert/strict";
import test from "node:test";

import { renderConfig } from "../src/render-config.js";

test("renders a numeric maxLength of zero", () => {
  assert.equal(renderConfig({ maxLength: 0 }), '<input maxlength="0">');
});

test("omits maxLength only when it is absent", () => {
  assert.equal(renderConfig({}), "<input >");
});
