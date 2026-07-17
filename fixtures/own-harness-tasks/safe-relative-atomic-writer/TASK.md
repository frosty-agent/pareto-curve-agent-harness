# Safe relative atomic writer

`writeFileAtomic(root, relativePath, content)` must write only below `root`. Reject a requested path that escapes the supplied root (for example `../escaped.txt`) before creating any directory or file. Preserve the existing atomic write behavior for valid relative paths: write a sibling temporary file and rename it into place.

Make the smallest local production-code change necessary. Do not modify `test/` or task metadata.

Regression command (run exactly, with no shell):

```text
node --test test/writer.test.js
```

The checked-in baseline is intentionally broken: this regression command is expected to fail before the intended fix and pass afterward.
