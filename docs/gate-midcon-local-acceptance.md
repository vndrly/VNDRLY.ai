# MidCon local acceptance evidence

Validated only against the guarded, fresh local PostgreSQL database and loopback API/browser servers. No production records, auth mocks, response interception, fake clocks, resets, or deletes were used.

## Actual PostgreSQL and HTTP

`artifacts/api-server/src/routes/gate-midcon.acceptance.test.ts` passed **8/8** tests. It inserts unique synthetic company/site fixtures, resolves two real normalized gatekeeper memberships, and sends signed sessions through the actual Express routes.

Covered normal outer → inner → outer checkout with audit actors/timestamps; early turnaround with its audit note; four simultaneous inner-arrival/outer-checkout races with one success and one conflict each; returning inside without creating another visit; parallel outer-gate deduplication/checkout; GPS exit observations retaining the open visit; guest checkout/recheckin guards; and an unauthorized office member receiving 403.

Run through the existing fresh-local environment with:

```sh
corepack pnpm --filter @workspace/api-server exec vitest run src/routes/gate-midcon.acceptance.test.ts
```

## Actual Chromium walkthrough

`artifacts/api-server/scripts/gate-browser-acceptance.mjs` uses two isolated Chromium contexts with real gatekeeper cookies resolved from database memberships. It inserts a separate synthetic site and scoped grants. API and Vite must already run against the same isolated database at `127.0.0.1:18080` and `127.0.0.1:15173`; the harness does not restart them.

```sh
corepack pnpm --filter @workspace/api-server exec tsx scripts/gate-browser-acceptance.mjs
```

Passed actual Gate controls for normal travel, early turnaround, and return. Assertions verified sole-destination checkin without an unnecessary selector; green pending arrival/departure rows; infinite pending-tab animation and its removal after resolution; neutral completed rows; returning to inner On Site and removing outer pending departure; Gate Map's separate last-confirmed location/intended destination with its explicit “not live GPS” label; and both gatekeepers' Gate Logs containing events, gate names, actors, timestamps, and the early-exit note. No browser page errors occurred.

Local artifacts: `artifacts/api-server/.local/gate-browser/evidence.json`, numbered screenshots in the same directory, `/tmp/gate-midcon-acceptance.log`, and `/tmp/gate-browser-acceptance.log`.

The local app has no Mapbox token. The Gate Map state summary was verified; geographic basemap/pin rendering was unavailable and is not claimed as validated.
