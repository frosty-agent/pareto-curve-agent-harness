# Signed token malformed input

`verifySignedToken()` verifies tokens in `<base64url JSON payload>.<base64url HMAC-SHA-256 signature>` form and returns the parsed payload only for a valid signature. Any malformed input—including a missing or extra segment, invalid base64url, invalid UTF-8/JSON, or a wrong signature—must return `null` without throwing. Use timing-safe comparison only after confirming equal signature lengths.

Make the smallest local production-code change necessary. Do not modify `test/` or task metadata.

Regression command (run exactly, with no shell):

```text
node --test test/token.test.js
```

The checked-in baseline is intentionally broken: this regression command is expected to fail before the intended fix and pass afterward.
