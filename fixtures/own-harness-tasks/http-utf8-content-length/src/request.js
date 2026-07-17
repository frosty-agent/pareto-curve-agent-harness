export function createRequest(body) {
  return {
    headers: {
      "content-length": String(body.length),
    },
    body,
  };
}
