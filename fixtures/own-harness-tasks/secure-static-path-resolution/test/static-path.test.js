import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveStaticPath } from "../src/static-path.js";

test("returns the canonical path for an existing nested static file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "static-root-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "hello.txt"), "hello");

  assert.equal(await resolveStaticPath(root, "/hello.txt"), await realpath(join(root, "hello.txt")));
});

test("rejects encoded traversal, malformed paths, and external symlinks", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "static-root-"));
  const outside = await mkdtemp(join(tmpdir(), "static-outside-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  const secret = join(outside, "secret.txt");
  await writeFile(secret, "secret");
  await symlink(secret, join(root, "leak.txt"));

  for (const requestPath of ["/%2e%2e/secret.txt", "/%ZZ", "/leak.txt", "/"]) {
    assert.equal(await resolveStaticPath(root, requestPath), null, requestPath);
  }
});
