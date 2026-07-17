# NDJSON chunk framer

`NdjsonFramer.push(chunk)` receives arbitrary string chunks and returns each complete JSON value terminated by a newline. It must retain an incomplete line for the next chunk, including when a JSON object is split across chunks. Ignore a final empty line.

Make the smallest local production-code change necessary. Do not modify `test/` or task metadata.

Regression command (run exactly, with no shell):

```text
node --test test/framer.test.js
```

The checked-in baseline is intentionally broken: this regression command is expected to fail before the intended fix and pass afterward.
