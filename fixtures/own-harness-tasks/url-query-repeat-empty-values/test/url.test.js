import assert from "node:assert/strict";
import test from "node:test";

import { buildUrl } from "../src/url.js";

test("repeats array values and preserves empty query values", () => {
  assert.equal(
    buildUrl("/search", { tag: ["node", ""], q: "" }),
    "/search?tag=node&tag=&q=",
  );
});

test("keeps ordinary scalar query values", () => {
  assert.equal(buildUrl("/search", { page: "2" }), "/search?page=2");
});
