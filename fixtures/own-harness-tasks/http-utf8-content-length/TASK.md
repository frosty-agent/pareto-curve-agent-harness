# HTTP UTF-8 content length

`createRequest(body)` must set the `content-length` header to the number of bytes in the UTF-8 request body, not the number of JavaScript characters. Preserve the supplied body and existing header shape.

Make the smallest local production-code change necessary. Do not modify `test/` or task metadata.

Regression command (run exactly, with no shell):

```text
node --test test/request.test.js
```

The checked-in baseline is intentionally broken: this regression command is expected to fail before the intended fix and pass afterward.
