import { createHash } from "node:crypto";

export function createConditionalFileResponse(body, { method = "GET", ifNoneMatch } = {}) {
  const content = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const etag = `"${createHash("sha256").update(content).digest("hex")}"`;
  const matches = ifNoneMatch === "*" || ifNoneMatch === etag;

  if (matches) return { status: 304, headers: { etag }, body: Buffer.alloc(0) };
  return { status: 200, headers: { etag }, body: method === "HEAD" ? Buffer.alloc(0) : content };
}
