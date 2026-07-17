import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function writeFileAtomic(root, relativePath, content) {
  const destination = join(root, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, destination);
}
