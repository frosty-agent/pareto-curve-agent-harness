# Retry cancellation during backoff

Add support for an optional `AbortSignal` in `retry()`. A signal that is already aborted, or becomes aborted while the injected backoff delay is running, must stop the retry loop immediately and reject with the signal's reason. Do not start another operation after cancellation.

Make the smallest local production-code change necessary. Do not modify `test/` or task metadata.

Regression command (run exactly, with no shell):

```text
node --test test/retry.test.js
```

The checked-in baseline is intentionally broken: this regression command is expected to fail before the intended fix and pass afterward.
