# Content-Type quoted parameters

`parseContentType()` must parse an HTTP `Content-Type` header into its lowercase media type and lowercase parameter names. Parameter values may be quoted; semicolons inside quoted values are data, and quoted-pair escapes such as `\\\"` and `\\\\` must be unescaped. Reject malformed headers and malformed parameter syntax by returning `null`.

Make the smallest local production-code change necessary. Do not modify `test/` or task metadata.

Regression command (run exactly, with no shell):

```text
node --test test/content-type.test.js
```

The checked-in baseline is intentionally broken: this regression command is expected to fail before the intended fix and pass afterward.
