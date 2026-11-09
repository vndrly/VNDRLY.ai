# Gate helper signed-in performance — 2026-11-09

This comparison uses the current Gate helper provider with actual signed-in UI/API reads, the same synthetic user42/vendor13/membership41, and the same isolated local PostgreSQL database throughout. It is a Vite development preview under concurrent validation load, not a production speed claim.

Two rotated runs used a new browser context per page/mode, then in-app navigation away and back for the repeat visit. Enabled mode uses the real global provider and summary. Disabled mode intercepts only the local use-account-next-steps module to disable that summary subscription and the helper UI; page, notification and training consumers remain active. All non-read API calls were blocked after authentication. No customer accounts, assignments, watches or notifications were changed.

Dashboard usability required opening an actual statistics details dialog and closing it. Work Hub required its Tasks link to pass a visible, stable, enabled and unobscured trial click. Each check includes two animation frames. Helper settlement separately waits until the navigation helper's saved summary is no longer pending; the panel remains closed. There were16 successful probes with no page errors.

| Run | Page | Next Steps | Visit | Usable control (ms) | Helper settled (ms) |
|---|---|---|---|---:|---:|
| 1 | dashboard | enabled | cold | 3930 | 3666 |
| 1 | dashboard | enabled | repeat | 579 | 261 |
| 1 | dashboard | disabled | cold | 3931 | 3695 |
| 1 | dashboard | disabled | repeat | 687 | 206 |
| 1 | work-hub | enabled | cold | 5255 | 5184 |
| 1 | work-hub | enabled | repeat | 680 | 593 |
| 1 | work-hub | disabled | cold | 7002 | 6921 |
| 1 | work-hub | disabled | repeat | 399 | 208 |
| 2 | dashboard | disabled | cold | 4711 | 4250 |
| 2 | dashboard | disabled | repeat | 541 | 195 |
| 2 | dashboard | enabled | cold | 6965 | 6642 |
| 2 | dashboard | enabled | repeat | 652 | 317 |
| 2 | work-hub | disabled | cold | 5336 | 5051 |
| 2 | work-hub | disabled | repeat | 476 | 256 |
| 2 | work-hub | enabled | cold | 7284 | 7239 |
| 2 | work-hub | enabled | repeat | 542 | 365 |

Each enabled cold visit made exactly one successful GET /api/account-next-steps, taking154.5/111.8/188.2/181.4ms. Disabled visits made none, and no repeat visit reread it within the observation window. The shared query survives page navigation. No relationship lookup or assigned-training lookup originates from the helper. Existing global training-prefetch reads remain because other surfaces consume them.

Cold usable-control differences were inconsistent: dashboard enabled minus disabled was -1ms and +2254ms; Work Hub was -1747ms and +1948ms. Repeat mean differences were +1.5ms on dashboard and +173.5ms on Work Hub. Two samples per condition under shared validation load cannot establish a stable speed improvement or causal regression. The measured summary request cost is reported separately from page usability.

The intentionally minimal company has no built training/safety projections. Both modes produced exactly the same error totals: team-progress503 four times, safety-summary503 eight times, progress503 eight times, safety/metrics500 four times and safety/maturity403 four times. Those remaining projection/session/permission delays and independent retry reads are not attributed to Next Steps. They also prevent presenting this run as a healthy production-load baseline. The previous healthy local signed-in comparison is preserved in [next-steps-local-performance.md](next-steps-local-performance.md).

Raw ignored evidence: .local/next-steps-performance/local-comparison.json and /tmp/vndrly-gate-nextsteps-performance-final.log. An earlier incomplete attempt used an outdated dashboard control selector and is retained separately as pre-control-correction.json; it is excluded from these results. Static imports cancelled when a browser context closes are retained in raw failure events; no page error or actionable-control failure occurred in the final run.

Reproduce with scripts/measure-next-steps-local.mjs using NEXT_STEPS_BENCH_URL plus existing NEXT_STEPS_BENCH_USER/PASSWORD, or NEXT_STEPS_BENCH_FIXTURE pointing to ignored isolated browser fixture metadata. The harness permits loopback previews only, never seeds/resets a database and saves no cookies, passwords or tokens. Fixture credentials remain only in ignored metadata and browser memory.
