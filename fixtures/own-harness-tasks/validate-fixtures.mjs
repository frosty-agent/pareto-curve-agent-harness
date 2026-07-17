import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));

function fail(message) {
  throw new Error(`invalid owned fixture manifest: ${message}`);
}

function relativeChild(parent, child, label) {
  const target = resolve(parent, child);
  if (target !== parent && !target.startsWith(`${parent}${sep}`)) fail(`${label} escapes its fixture`);
  return target;
}

async function baselineDigest(workspace, files) {
  const hash = createHash("sha256");
  for (const file of [...files].sort()) {
    if (typeof file !== "string" || !file || file.includes("\\") || file.startsWith("/") || file.split("/").includes("..")) fail("baseline files must be safe relative paths");
    hash.update(Buffer.from(`${file}\0`, "utf8"));
    hash.update(await readFile(relativeChild(workspace, file, `baseline file ${file}`)));
  }
  return hash.digest("hex");
}

if (manifest?.schemaVersion !== "pareto-owned-node-fixtures/v1" || !Array.isArray(manifest.tasks) || manifest.tasks.length !== 3) {
  fail("expected schema version and exactly three tasks");
}
const ids = new Set();
for (const task of manifest.tasks) {
  if (typeof task?.id !== "string" || !task.id || ids.has(task.id)) fail("task ids must be unique nonempty strings");
  ids.add(task.id);
  if (typeof task.workspace !== "string" || task.workspace !== task.id || task.workspace.includes("/") || task.workspace.includes("\\")) fail(`${task.id}: workspace must equal a simple task id`);
  const workspace = relativeChild(root, task.workspace, `${task.id}: workspace`);
  if (typeof task.promptFile !== "string" || task.promptFile !== "TASK.md") fail(`${task.id}: promptFile must be TASK.md`);
  const prompt = await readFile(relativeChild(workspace, task.promptFile, `${task.id}: prompt`), "utf8");
  const argv = task?.regression?.argv;
  if (!Array.isArray(argv) || argv.length < 3 || argv[0] !== "node" || argv[1] !== "--test" || argv.some((arg) => typeof arg !== "string" || !arg)) fail(`${task.id}: regression argv must be exact node --test argv`);
  const command = argv.join(" ");
  if (task.regression.command !== command || !prompt.includes(command) || !prompt.includes("intentionally broken")) fail(`${task.id}: prompt and regression command must agree`);
  if (task?.baseline?.status !== "expected_regression_failure" || !Array.isArray(task.baseline.files) || !/^[a-f0-9]{64}$/.test(task.baseline.sha256 ?? "")) fail(`${task.id}: invalid baseline metadata`);
  const actualHash = await baselineDigest(workspace, task.baseline.files);
  if (actualHash !== task.baseline.sha256) fail(`${task.id}: baseline sha256 mismatch (${actualHash})`);
  try {
    // Node's own test runner sets NODE_TEST_CONTEXT for its child process. Do not
    // leak that internal mode into a nested fixture regression command.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    await execFileAsync(argv[0], argv.slice(1), { cwd: workspace, env });
    fail(`${task.id}: baseline regression unexpectedly passed`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("invalid owned fixture manifest:")) throw error;
    if (typeof error !== "object" || error === null || (error).code === undefined) throw error;
  }
}
console.log(`validated ${manifest.tasks.length} intentionally failing fixture baselines`);
