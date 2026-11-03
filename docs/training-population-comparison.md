# Work Hub training population comparison — 2026-11-03

Selected **early authenticated prefetch with existing in-memory query caching**.
Normal Work Hub now starts personal progress and safety-summary reads as soon as
the authenticated company context is settled, before the Work Hub module finishes
loading. Team progress starts only after the personal response grants access.
The normal route, card layout, response data, authorization, and freshness windows
remain unchanged. No persistent browser storage, new dependency, or database
change was introduced.

## Rendered comparison

Base checkout: `fd64d50a546ca378a0d12ffc58652fdf65e677b8`, plus the comparison
implementation. Existing GateGo vendor administrator account and its real saved
assignments; no training records created or edited for testing.

Three rotated rounds, one long-lived local API, optimized Vite `benchmark` build,
headless Microsoft Edge, localhost HTTP, ordinary workstation network. Each cold
run creates a fresh browser context, signs in through the existing API, then starts
the timer immediately before navigating to Work Hub. Sign-in request time is not
included; page authentication (`/auth/me`), assets, data requests and rendering are.
Warm runs navigate to Tasks and back within the same app/query cache.

Completion requires personal certification rows, overall percentage, safety score
and bonus, and authorized Team Training data to be ready, followed by two animation
frames. Initial errors/timeouts never count as populated. Screenshots and DOM were
captured, and the populated card was visually inspected. This measures the entire
VNDRLY/U card, not completion of every unrelated Work Hub card.

| Method | Cold runs (seconds) | Cold median | Warm runs (milliseconds) |
| --- | --- | --- | --- |
| Baseline | 19.212, timeout >60, 29.572 | 29.572 s | 60, timeout >60000, 55 |
| Fresh server optimization | 24.603, timeout >60, 28.438 | 28.438 s | 63, timeout >60000, 12563 |
| Lightweight route + parallel reads | 16.178, 7.085, 3.922 | 7.085 s | 47, 61, 63 |
| Early prefetch / existing cache | 3.421, 5.795, 4.902 | **4.902 s** | **57, 62, 51** |

Timeouts are censored above 60 seconds and retained when selecting the median;
neither failing method is ranked using only successful runs. Prefetch completed
all six cold/warm trials. Its cold median was about 83% below baseline, and its
warm median was 57 ms. **Cold sub-one-second population was not achieved.** These
are local workstation results, not measurements on an iPhone or the deployed site.

All successful trials had identical card text and identical SHA-256 hashes for
personal progress, team progress, and safety-summary JSON:

- Personal: `02dff4af76418dba7113d7f2102e67b24251e95bdacab84b47b8eaacf88e77ec`
- Team: `e4e727cffb3e0aac8a2eeb2f19292fedca6c235d83c6b343f27a256f1942d27e`
- Safety: `01598959adbd3aec93ccbe3324aa6593627cf2f11fd823ea0521f0e07b6b4d44`

Raw timings, request evidence, card HTML and screenshots are in the ignored local
directory `.local/training-population-built/`. Initial development-server timings
were exploratory and were not used to choose the winner.

## Reproduce

Existing credentials must be supplied privately as `TRAINING_BENCH_USER` and
`TRAINING_BENCH_PASSWORD`; the script does not seed accounts or print credentials.

1. Start the existing local API on port 8080.
2. Build: `pnpm --filter @workspace/vndrly exec vite build --mode benchmark --outDir .local/training-benchmark`.
3. Serve that output using Vite preview on a local port with
   `VITE_API_PROXY_TARGET=http://localhost:8080`.
4. Set `TRAINING_BENCH_URL` to that localhost origin and run
   `node scripts/benchmark-training-population.mjs`.

Ghost URLs use `?progressMethod=baseline`, `server`, `render`, or `cache`.
Selectors are accepted in development or the explicit benchmark build. The later
server investigation also enables explicit production ghost links by adding
`progressBenchmark=1`; API cache bypass requires the current company administrator.
Every experiment bypasses the shared server summary cache equally; the server
method alone enables its optimized calculation. Warm runs retain existing client
freshness rules. Ordinary production navigation sends no experiment header and
uses early prefetch with the ordinary server cache.

Additional final-default measurements must be reported separately because normal
production caching is enabled there. Tests cover content/bonus equivalence,
allowed and denied document access, selector isolation, permission-first team
prefetch, identity switches, late responses, and offline/context/password guards.

## Final normal Work Hub verification

After promotion, the normal production build was served locally and measured at
ordinary `/work-hub`, with no experiment selector or experiment request header.
The normal server cache remained enabled. Fresh browser contexts took **24.156,
1.403, and 1.564 seconds** (median **1.564 seconds**). Warm returns took **65, 67,
and 52 ms** (median **65 ms**). The first run waited 14.29 seconds for personal
progress and 17.41 seconds for safety-summary; later cache-backed responses took
roughly 0.22–0.38 seconds. Thus the slow API outlier remains, and the implementation
must not be described as consistently sub-one-second on a fresh page.

All six final trials completed without page errors. Card text and all three
payload hashes matched the comparison trials. Final card screenshot was visually
inspected. Raw final evidence is in `.local/training-population-final/`.

Both web and API TypeScript checks passed. Focused verification passed **38 web
tests and 22 API tests**. Normal production build passed. The benchmark variants
remain available locally for comparison; the selected prefetch is the ordinary
Work Hub default. This work was implemented and verified locally, not published.
