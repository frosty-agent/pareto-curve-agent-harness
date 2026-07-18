# Owned Node fixture tasks

These are 13 self-contained, dependency-free Node fixture repositories for the own-harness comparison. Each task directory is copied into a fresh disposable workspace before an agent runs. The checked-in source is deliberately broken, so its declared regression test **must fail at the baseline**. A candidate is accepted only when that exact `node --test` argv exits zero after a production-code-only repair.

`manifest.json` pins each fixture's task prompt, exact no-shell argv, and baseline SHA-256. The digest is deterministic: concatenate the UTF-8 bytes of every `baseline.files` entry in lexicographic order, prefixing each one with `path + "\\0"`; then hash with SHA-256. `TASK.md` and `manifest.json` are runner metadata and are intentionally not included in the baseline digest.

Run `node validate-fixtures.mjs` from this directory to validate the manifest/digests and prove every baseline regression currently fails. It intentionally returns zero only when the task metadata is valid and all 13 baseline failures are observed.
