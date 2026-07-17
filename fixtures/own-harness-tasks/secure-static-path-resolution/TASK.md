# Secure static path resolution

`resolveStaticPath()` must resolve a URL pathname to an existing regular file below a static root. Decode percent escapes exactly once, reject malformed encoding, absolute paths, traversal (`..`) after decoding, directories, and symlinks that resolve outside the root. Return the canonical file path for a safe file and `null` for any rejected request.

Make the smallest local production-code change necessary. Do not modify `test/` or task metadata.

Regression command (run exactly, with no shell):

```text
node --test test/static-path.test.js
```

The checked-in baseline is intentionally broken: this regression command is expected to fail before the intended fix and pass afterward.
