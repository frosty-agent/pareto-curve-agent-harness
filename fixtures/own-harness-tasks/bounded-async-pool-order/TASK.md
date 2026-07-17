# Bounded async pool result order

`mapLimit(values, limit, mapper)` must run no more than `limit` mappers at once and resolve to results in the same order as `values`, even when mappers finish out of order. Preserve the current mapper arguments.

Make the smallest local production-code change necessary. Do not modify `test/` or task metadata.

Regression command (run exactly, with no shell):

```text
node --test test/pool.test.js
```

The checked-in baseline is intentionally broken: this regression command is expected to fail before the intended fix and pass afterward.
