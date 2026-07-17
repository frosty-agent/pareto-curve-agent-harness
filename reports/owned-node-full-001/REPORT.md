# Owned Node fixture comparison — tier: `full` (13/13 tasks)

## Scope and validity

This is the complete 13-task owned, dependency-free Node fixture suite. Both policies used the same copied baseline, task prompt, bounded tool contract, immutable `node --test` regression command, OpenRouter account, and provider-reported `usage.cost` accounting. No Docker, Python, external benchmark, or external task runtime was used.

All 26 policy rows have complete provider cost. `retry-cancellation-backoff` was rerun once after its first full-suite process failed before writing a result; the replacement row is identified by its durable source run below.

## Aggregate result

| Policy | Resolved | Actual provider cost | Cost / resolved |
|---|---:|---:|---:|
| Generic fixed `openai/gpt-5.6-luna` | **4 / 13** | **$0.240362** | $0.060090 |
| Frozen nine-rung Pareto | **10 / 13** | **$0.681244** | $0.068124 |

Pareto resolved six additional fixtures (10 versus 4), but at a higher total cost ($0.681244 versus $0.240362) and higher cost per resolved task ($0.068124 versus $0.060090). The harder protocol/security fixtures often required several Pareto rungs; this is the intended tradeoff the full tier exposes.

## Per-task outcome

| Task | Generic | Generic cost | Pareto | Pareto cost |
|---|---|---:|---|---:|
| `config-numeric-attribute` | resolved | $0.009515 | resolved | $0.001010 |
| `retry-cancellation-backoff` | unresolved | $0.029455 | resolved | $0.003540 |
| `safe-relative-atomic-writer` | unresolved | $0.018716 | resolved | $0.002748 |
| `http-utf8-content-length` | resolved | $0.005084 | resolved | $0.000862 |
| `url-query-repeat-empty-values` | resolved | $0.009146 | resolved | $0.001091 |
| `cli-options-double-dash` | unresolved | $0.016959 | resolved | $0.010508 |
| `ndjson-chunk-framer` | resolved | $0.006278 | resolved | $0.001204 |
| `bounded-async-pool-order` | unresolved | $0.013775 | resolved | $0.000810 |
| `http-range-single-byte` | unresolved | $0.017473 | unresolved | $0.161402 |
| `content-type-quoted-parameters` | unresolved | $0.046498 | unresolved | $0.236988 |
| `etag-conditional-file-response` | unresolved | $0.020935 | resolved | $0.007374 |
| `signed-token-malformed-input` | unresolved | $0.020511 | resolved | $0.058192 |
| `secure-static-path-resolution` | unresolved | $0.026017 | unresolved | $0.195514 |

## Artifacts

- `aggregate-results.json` and `aggregate-results.csv`: all 26 paired rows.
- Per-task source artifacts under this run directory; retry replacement: `../owned-node-full-001-retry/`.

This is a directional comparison of deliberately owned fixtures, not a general coding benchmark claim.
