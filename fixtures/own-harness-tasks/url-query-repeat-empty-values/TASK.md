# URL query repeat and empty values

`buildUrl(path, query)` must encode every query value. Array values produce repeated keys in order, and empty-string values must remain present as `key=`. Preserve the path and normal scalar query values.

Make the smallest local production-code change necessary. Do not modify `test/` or task metadata.

Regression command (run exactly, with no shell):

```text
node --test test/url.test.js
```

The checked-in baseline is intentionally broken: this regression command is expected to fail before the intended fix and pass afterward.
