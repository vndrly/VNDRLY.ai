# Changed Next Steps local signed-in measurement — 2026-11-09

This measures the changed implementation against actual authenticated local API routes and an isolated fresh PostgreSQL database, with the same synthetic admin/company throughout (user 1, vendor 1, membership 1). It is not a deployed-production speed measurement. All observed read responses in the final comparison were successful; there were no page errors or failed readiness probes.

## Isolation and method

Fixture provisioning used the repository isolation guard and verified current_database against the wrapper-owned fresh target. It inserted a distinct synthetic company/user/membership; no existing rows were reset or altered. API startup imported app routes without index startup workers/provisioners. Before final measurement, existing training/global-safety worker builders populated this isolated company's stored summaries; direct authenticated health checks then returned200 for summary, progress, team-progress, safety-summary, safety metrics and safety maturity. No hosted database or authentication service was used. All non-read browser API requests were blocked after sign-in.

Two rotated runs used fresh browser contexts for each surface/mode, then navigated in-app away and back for repeat visits. Disabled mode returned null at the start of AccountNextSteps in intercepted local module code, leaving all other components unchanged. Chromium DevTools Protocol recorded request initiator frames as well as response timings.

Dashboard usability required actually opening its Site Locations details dialog, observing the dialog, and closing it. Work Hub required the Tasks link to pass Playwright's visible, stable, enabled and unobscured trial click. Each probe was followed by two animation frames. These establish specific usable controls, not exhaustive feature acceptance.

Whole-helper settlement was measured concurrently using the settled marker, which now covers both account summary and dashboard relationships query observers, followed by two animation frames. Disabled-helper timing means the surface had rendered and two frames elapsed with no helper subscription.

## Final healthy measurements

| Run | Surface | Helper | Visit | Actionable probe (ms) | Whole helper settled (ms) |
|---|---|---|---|---:|---:|
| 1 | dashboard | enabled | cold | 5551 | 5178 |
| 1 | dashboard | enabled | repeat | 619 | 285 |
| 1 | dashboard | disabled | cold | 4562 | 4314 |
| 1 | dashboard | disabled | repeat | 765 | 289 |
| 1 | work-hub | enabled | cold | 5125 | 5106 |
| 1 | work-hub | enabled | repeat | 291 | 205 |
| 1 | work-hub | disabled | cold | 4945 | 4862 |
| 1 | work-hub | disabled | repeat | 250 | 142 |
| 2 | dashboard | disabled | cold | 5913 | 5450 |
| 2 | dashboard | disabled | repeat | 1641 | 830 |
| 2 | dashboard | enabled | cold | 7841 | 7555 |
| 2 | dashboard | enabled | repeat | 803 | 394 |
| 2 | work-hub | disabled | cold | 5412 | 5328 |
| 2 | work-hub | disabled | repeat | 243 | 155 |
| 2 | work-hub | enabled | cold | 5383 | 5391 |
| 2 | work-hub | enabled | repeat | 304 | 240 |

Enabled dashboard cold probes took 5.551/7.841 s versus disabled 4.562/5.913 s in these samples. Work Hub enabled took 5.125/5.383 s versus disabled 4.945/5.412 s. This does not demonstrate a speed improvement: dashboard enabled was slower in both runs, while Work Hub differences changed direction. Two samples per condition in a development server with shared concurrent acceptance work cannot establish a stable causal regression either. Repeat visits retain caches and are not cold-load evidence.

## Request evidence

- Each enabled cold visit issued exactly one successful GET /api/account-next-steps. Browser request durations were 64.233, 122.994, 104.863 and 144.684 ms. Disabled visits issued none. No repeat visit refetched the summary during the observation window.
- Enabled dashboard cold visits also issued exactly one successful partner-relationships read; disabled visits issued none. Whole-helper settlement includes this observer.
- Every cold visit in both conditions retained exactly one successful request each for repository progress, safety-summary and team-progress. None of these training request initiators include next-steps.tsx. The summary request initiator explicitly includes read/queryFn in next-steps.tsx; training requests originate through work-hub-client.ts/request-deadline.ts. Thus the helper no longer requests assigned training, while legitimate other consumers retain their requests.
- Remaining repeats were independent of helper mode: dashboard onboarding/me three times; Work Hub company-operations, home and workday twice, plus vendor identity twice on cold visits. These are observed URL counts, not proof of a particular query-key bug.
- There were no observed HTTP4xx/5xx read responses or page errors across all16 final samples. Only the explicitly blocked automatic non-read device calls failed.

## Limits and reproduction

This is a minimal synthetic company on Vite development builds with browser-only module interception. It establishes real signed-in request behavior and usable controls, not production-scale speed or every workflow. Concurrent local acceptance work shares the machine/database. No production deployment, live business-data change, credential rotation or assignment change was performed for this comparison.

Raw ignored final evidence: .local/next-steps-performance/local-comparison.json and local-comparison.log. Authenticated health results: local-post-worker-health.json. Reproduce using scripts/measure-next-steps-local.mjs with an existing isolated fixture's NEXT_STEPS_BENCH_USER and NEXT_STEPS_BENCH_PASSWORD, optional NEXT_STEPS_BENCH_URL/CHROMIUM_PATH. The tracked harness restricts URLs to loopback, never seeds/resets data, and saves no passwords, tokens, cookies or response bodies. Syntax validation passed.

The earlier pre-worker comparison is preserved separately as local-pre-worker-comparison.json/.log and local-pre-worker-report.md under the same ignored directory. Its training503/safety500/403 responses and partial summary-only settlement marker are not mixed into these final healthy results. Populating the real stored summaries removed the failure-driven duplicate training requests without changing the helper's requests.
