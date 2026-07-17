import assert from "node:assert/strict";
import test from "node:test";

import { signToken, verifySignedToken } from "../src/token.js";

test("returns the payload from a valid signed token", () => {
  const token = signToken({ sub: "member-7", scopes: ["read"] }, "shared secret");
  assert.deepEqual(verifySignedToken(token, "shared secret"), { sub: "member-7", scopes: ["read"] });
});

test("returns null rather than throwing for malformed or tampered tokens", () => {
  const token = signToken({ sub: "member-7" }, "shared secret");
  for (const candidate of ["", "one", "one.two.three", ".signature", "%%%.%%%", `${token}x`, token.replace(/.$/, "x")]) {
    assert.doesNotThrow(() => verifySignedToken(candidate, "shared secret"), candidate);
    assert.equal(verifySignedToken(candidate, "shared secret"), null, candidate);
  }
});
