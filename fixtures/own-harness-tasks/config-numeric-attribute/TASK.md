# Config numeric attribute

`renderConfig()` must render `maxlength` whenever `config.maxLength` is provided, including the numeric value `0`. It must continue omitting the attribute when `maxLength` is absent.

Make the smallest local production-code change necessary. Do not modify `test/` or task metadata.

Regression command (run exactly, with no shell):

```text
node --test test/config.test.js
```

The checked-in baseline is intentionally broken: this regression command is expected to fail before the intended fix and pass afterward.
