# Next Steps signed-in performance baseline — 2026-11-09

This is a real **pre-change live baseline**, not a measurement of the new summary endpoint. Chromium opened https://vndrly.ai using the existing documented canonical vendor fixture: user 406, vendor 2, active membership 332. No credentials, tokens, response bodies or customer contents are retained in this report.

## Method

Two runs rotated enabled/disabled order. Each mode/surface used a fresh authenticated browser context (cold), then navigated in-app to Work Hub tasks and back (repeat), retaining its QueryClient. The same account/company was used throughout.

Browser request interception altered only the live AccountNextSteps function: disabled returned null before its hooks; enabled recorded its query observers' isFetching state. Shared training prefetch, other components and API responses were untouched. This is a browser-only experiment; no deployed assets were changed. Interception of script bundles adds overhead in both modes.

“Surface visible” means dashboard root, or observed Work Hub heading, visible followed by two animation frames. It measures rendered shell availability; it does **not** establish that every dashboard card has populated or every interaction works. “Helper settled” separately means the helper's query observers stopped fetching, followed by two animation frames. The disabled helper is immediately settled once invoked.

All non-GET/HEAD API requests were blocked during comparison, including automatic device registration/heartbeats. Initial connectivity discovery before this guard observed the app issue an automatic device registration/heartbeat; no assignments, business records or credentials were deliberately changed.

Live helper bundle SHA-256: 25c4113d2b788008dacffd53d3b7c598c2a2f00a0efbcb28db34e620cbb0983e. Raw ignored evidence and runnable experiment: .local/next-steps-performance/live-comparison.json and compare-live.mjs. Failed selector discovery attempts remain in live-comparison.log; the completed comparison contains 16 successful samples.

## Observed milliseconds

| Run | Surface | Helper | Phase | Surface visible | Helper settled |
|---|---|---|---|---:|---:|
| 1 | dashboard | enabled | cold | 5949 | 6697 |
| 1 | dashboard | enabled | repeat | 466 | 519 |
| 1 | dashboard | disabled | cold | 4711 | 4792 |
| 1 | dashboard | disabled | repeat | 344 | 385 |
| 1 | work-hub | enabled | cold | 2965 | 3147 |
| 1 | work-hub | enabled | repeat | 260 | 417 |
| 1 | work-hub | disabled | cold | 3066 | 3149 |
| 1 | work-hub | disabled | repeat | 109 | 142 |
| 2 | dashboard | disabled | cold | 3617 | 3683 |
| 2 | dashboard | disabled | repeat | 396 | 437 |
| 2 | dashboard | enabled | cold | 2813 | 3368 |
| 2 | dashboard | enabled | repeat | 189 | 223 |
| 2 | work-hub | disabled | cold | 2873 | 2931 |
| 2 | work-hub | disabled | repeat | 85 | 121 |
| 2 | work-hub | enabled | cold | 2842 | 3062 |
| 2 | work-hub | enabled | repeat | 81 | 378 |

Cold enabled dashboard times span 2.813–5.949 s versus disabled 3.617–4.711 s. Work Hub spans 2.842–2.965 s versus disabled 2.873–3.066 s. The rotated dashboard result changes direction; these two samples per condition do not establish a reliable causal page-speed improvement. In every enabled sample, the surface appeared before the helper settled.

## Request evidence

- Every cold sample, enabled and disabled, issued exactly one successful request each to repository/progress, repository/safety-summary and repository/team-progress. The baseline therefore does not show that removing Next Steps removes the page's training network traffic: other consumers/prefetch still need it.
- Enabled dashboard cold samples issued one partner-relationships request; disabled dashboard samples issued none. Work Hub issued none in either mode.
- Dashboard cold samples repeated onboarding/me three times in both conditions. Work Hub cold samples repeated company-operations twice in both conditions; vendor identity reads also repeated. Some enabled Work Hub samples repeated home twice. These are observed URL counts, not proof of identical React Query keys or of which component owns each call.
- Two existing uploaded-image reads returned 404 during baseline inventory. No source request returned authorization failure in the completed training/relationships traces.

## Post-change limit

The changed backend endpoint is not deployed, and this environment has no configured local database connection. These measurements cannot verify its signed-in response, browser request count or speed. Source/component tests can establish that the helper no longer subscribes to training progress, but only a trace against the changed authenticated API can establish the actual post-change request sequence. Preserve legitimate training requests from other components when verifying this. No deployment or database/data/assignment change was performed for this comparison.

## Reproduction and transport limitation

The tracked `scripts/measure-next-steps-live.mjs` reproduces this specific pre-change bundle experiment. Supply `NEXT_STEPS_BENCH_USER` and `NEXT_STEPS_BENCH_PASSWORD` through the environment; optionally set `CHROMIUM_PATH`. It honors `HTTPS_PROXY`, keeps TLS verification enabled, blocks non-read API requests after sign-in, saves only request metadata under ignored `.local`, and fails when the old deployed helper markers change. It does not support the new summary implementation without updating its explicitly checked instrumentation. Run with `node scripts/measure-next-steps-live.mjs`.

The original baseline browser context used `ignoreHTTPSErrors: true`; this was removed from the tracked reproduction harness. Its timings remain observations from that original browser setup, and do not establish verified TLS transport. No certificate error was investigated or used to explain the timings.

## Local login visual verification

Chromium rendered the changed login at 1440×1000 and 390×844 with English and Spanish selected. All four full-page screenshots were visually inspected. The credential card computed to `rgb(36, 36, 38)` (`#242426`) in every state. Selected language text was white with a white underline; inactive language text was `rgb(229, 231, 235)` without an underline. Document width equaled viewport width in all four states, with no horizontal overflow. The narrow card stayed between x=24 and x=366 (342 px wide); translations wrapped within the layout. The narrow page scrolls vertically to its footer.

Screenshots: `.local/next-steps-performance/login-{desktop,narrow}-{en,es}.png`; computed evidence: `login-visual.json`. These unauthenticated visual checks supplied a browser-only 401 response for the absent local `/api/auth/me` and 404 for other absent APIs. This was necessary because an unavailable session API correctly leaves auth bootstrap unresolved; it did not test real local authentication. No login source changes were needed for verification.
