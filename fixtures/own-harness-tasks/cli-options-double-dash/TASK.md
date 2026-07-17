# CLI options after double dash

`parseArgs(tokens)` must stop parsing options at a standalone `--`. Every later token, including strings beginning with `-`, is positional. Options before the delimiter must keep their current behavior.

Make the smallest local production-code change necessary. Do not modify `test/` or task metadata.

Regression command (run exactly, with no shell):

```text
node --test test/args.test.js
```

The checked-in baseline is intentionally broken: this regression command is expected to fail before the intended fix and pass afterward.
