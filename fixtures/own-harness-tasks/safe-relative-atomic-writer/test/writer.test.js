import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeFileAtomic } from "../src/writer.js";

test("writes a relative destination atomically", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "atomic-writer-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFileAtomic(root, "nested/value.txt", "fresh");
  assert.equal(await readFile(join(root, "nested/value.txt"), "utf8"), "fresh");
});

test("rejects a path that escapes the supplied root", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "atomic-writer-"));
  const escaped = join(root, "..", "escaped.txt");
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(escaped, { force: true })]));

  await assert.rejects(writeFileAtomic(root, "../escaped.txt", "nope"), /relative path.*root/i);
});
