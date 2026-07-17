# ETag conditional file response

`createConditionalFileResponse()` must generate a quoted SHA-256 ETag for a file body. For a GET or HEAD request, `If-None-Match` uses weak comparison: `*`, a matching quoted tag, a matching weak tag, or a comma-separated list containing a match must return `304` with no body. A non-match returns `200` and the body; HEAD never returns a body. Always include the generated `etag` header.

Make the smallest local production-code change necessary. Do not modify `test/` or task metadata.

Regression command (run exactly, with no shell):

```text
node --test test/etag.test.js
```

The checked-in baseline is intentionally broken: this regression command is expected to fail before the intended fix and pass afterward.
