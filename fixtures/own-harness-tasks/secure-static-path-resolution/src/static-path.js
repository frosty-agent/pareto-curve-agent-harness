import { stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

export async function resolveStaticPath(root, requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const rootPath = resolve(root);
  const candidate = resolve(rootPath, `.${decoded}`);
  if (!candidate.startsWith(`${rootPath}${sep}`)) return null;
  const details = await stat(candidate);
  return details.isFile() ? candidate : null;
}
