# Training population server investigation — 2026-11-03

Follow-up scope: instrument connection acquisition, query execution, and result
projection; remove demonstrated repeated work; publish isolated ghost selectors
with the web/API fix and compare actual rendered `vndrly.ai` against localhost.
No data, assignments, credentials, or database schema changes are required.

## Observed before the fix

Three fresh authenticated Edge contexts at `https://vndrly.ai/work-hub` populated
the complete VNDRLY/U card in **16.132, 13.958, and 29.584 seconds**; warm returns
took **54, 51, and 51 ms**. These are navigation-to-render measurements, not API
timings. Full-card readiness includes personal courses, safety score/bonus and
authorized Team Training. Raw evidence: `.local/training-production-before/`.

Opt-in local request profiling separated pool acquisition from execution. One
safety-summary request waited **8.179 seconds** for its assignment read, versus
**401 ms** projecting results; its longest pool wait was **313 ms**. Another
baseline run spent **18.819 seconds** in that assignment read. SQL and parameters
are never retained by profiling; response diagnostics contain numeric metrics.

Read-only `EXPLAIN (ANALYZE, BUFFERS)` showed the company assignment join scanning
4,279 assignment rows, then memoizing 2,113 separate template lookups, including
unrelated companies. The original company query took **11.066 seconds**, then
**18.380 seconds** on a repeat. Personal-user filtering returned 26 rows in about
1–3 ms, demonstrating that the company-wide safety query had a different plan.

## Changes

- Reuse the request's already company-scoped catalog IDs to filter assignments
  directly, retaining submission ordering, memberships, versions and all
  completion rules. The direct query returned the same 556 rows in **1.463 s**
  with 55 physical buffer reads, versus the repeated join's 498 reads on that
  comparison. No index or schema change was made.
- Safety summary consumes only bonus progress. When no vendor augmentation
  exists, return zero bonus after a scoped presence read, without loading all
  employees' assignments or the entire course catalog. Augmented companies retain
  their existing version, expiry, document-access and acknowledgment checks.
- Keep request-local parse/index reuse and the selected early authenticated
  prefetch. Normal requests use optimized reads plus existing cache semantics.
  For authenticated company administrators, start Team Training alongside
  personal progress and safety, while retaining the server permission check and
  permission-gated display. Live browser traces showed Team Training waiting
  8.6–23.8 seconds before being sent, then returning in about 0.2–0.4 seconds.
  Moving it ahead of other home requests removes that serial connection queue.
- Add opt-in `Server-Timing` profiling: request wall time, cumulative and maximum
  pool wait/query execution, query count, queue count, and named read/projection
  stages. Diagnostics are returned only after current administrator authority is
  established. Normal requests do not collect query metrics.
- Ghosts are ordinary Work Hub with explicit URL selectors, not separate data
  stores. Production requires `progressBenchmark=1&progressMethod=baseline`,
  `server`, `render`, or `cache`. API cache bypass is allowed only for current
  company administrators; every endpoint still applies normal authorization.
  Ordinary users and unrecognized headers retain the normal path.

Use `scripts/profile-training-api.mjs` for bounded API measurements and
`scripts/benchmark-training-population.mjs` for rendered Edge measurements.
Both accept only localhost or the explicitly authorized `https://vndrly.ai`.
Supply existing credentials through the benchmark environment variables; neither
script prints credentials, seeds data, or changes assignments.

Live after-publication evidence and its exact commit are recorded separately in
the ignored `.local/training-server-state.json` checkpoint and benchmark outputs.
Do not infer sub-one-second cold population from a warm cache result.
