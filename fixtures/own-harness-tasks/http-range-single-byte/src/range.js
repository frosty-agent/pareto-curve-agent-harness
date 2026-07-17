export function createSingleRangeResponse(body, rangeHeader) {
  const content = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader ?? "");
  if (!match) return unsatisfiable(content.length);

  const start = Number(match[1]);
  const requestedEnd = match[2] === "" ? content.length - 1 : Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= content.length || requestedEnd < start) {
    return unsatisfiable(content.length);
  }

  const end = Math.min(requestedEnd, content.length - 1);
  return {
    status: 206,
    headers: {
      "accept-ranges": "bytes",
      "content-range": `bytes ${start}-${end}/${content.length}`,
      "content-length": String(end - start + 1),
    },
    body: content.subarray(start, end + 1),
  };
}

function unsatisfiable(length) {
  return { status: 416, headers: { "content-range": `bytes */${length}` }, body: Buffer.alloc(0) };
}
