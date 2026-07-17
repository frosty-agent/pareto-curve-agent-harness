# HTTP single-byte range responses

`createSingleRangeResponse()` must implement one valid HTTP `Range: bytes=...` request for an in-memory body. Support `start-end`, `start-`, and `-suffix` forms; return a `206` response with an inclusive `Content-Range` and matching body. A malformed, unsatisfiable, or multi-range request must return `416` with `Content-Range: bytes */<length>` and an empty body.

Make the smallest local production-code change necessary. Do not modify `test/` or task metadata.

Regression command (run exactly, with no shell):

```text
node --test test/range.test.js
```

The checked-in baseline is intentionally broken: this regression command is expected to fail before the intended fix and pass afterward.
