# MidCon guided setup cloud checkpoint

Recovered from `vndrly/VNDRLY.ai` main at `3a83c2b2`. The prior series-gate work was already merged; the cloud checkout was initially clean. Branch: `codex/midcon-guided-setup-cloud`. No push or deployment was requested or performed.

## Implemented

- A sole downstream secure gate becomes the default check-in destination. Explicit named destinations may be gated or ungated, with a configurable default.
- Movement history retains the original property visit and check-in clock. Inner confirmation, inner checkout, return, routing, and outer checkout drive the queues. Outer checkout compares saved movement history atomically; a concurrent arrival receives a refresh conflict. Early turnaround records `Exited before inner arrival`.
- Gate controls, pending text/pulse, neutral resolved records, 24/48-hour audit aging, movement actor/time, and Gate Map confirmed-location versus intended-destination display use saved movements. Parallel entrance groups resolve in either direction.
- Next Steps no longer subscribes to training. A company-scoped read endpoint derives unfinished account/credential steps and one first-watch blocker. Links retain authorized site/station/shift context. Saved watch plus confirmed same-company/site ticket completes the helper.
- Vendor Assume Watch creates/reuses its ticket in the same transaction; missing commercial prerequisites roll back the watch. Partner/platform watch custody remains supported without inventing a vendor ticket.
- Dark login card, readable language states and active underline. Four local browser screenshots verified desktop/narrow English/Spanish with no horizontal overflow.

## Verification

Focused web checkpoint: 124 tests across 11 suites, with subsequent affected-suite runs including 48 Gate tests and 47 setup/watch tests. Focused API checkpoint: 34 tests across six suites; subsequent topology/account tests and 20 route workflow tests cover destination defaults, inner return, early checkout, concurrent-arrival conflict, and existing linked gates. Web/API TypeScript checks and locale parity passed. These are focused checks, not a claim that the entire repository suite passed.

Initial focused checks used database mocks/in-memory stores. Continued verification now also uses a real, fresh isolated PostgreSQL 17 database. The actual two-gatekeeper HTTP and Chromium journeys pass; see [local Gate acceptance](gate-midcon-local-acceptance.md). No hosted database, database reset, destructive migration, or live customer-data change was used.

See the [pre-change live baseline](next-steps-performance-baseline.md) and [changed signed-in local comparison](next-steps-local-performance.md). The changed comparison has 16 successful healthy samples against real local authentication/database routes. The summary adds one 64–145 ms request per enabled cold visit and none on repeats; legitimate training requests originate elsewhere. Whole-card settlement includes partner relationships. Dashboard samples were slower with the helper; Work Hub differences were mixed, so no overall speed improvement is claimed.

## Acceptance status

1. Configure and walk the actual Warwick Completions 1 → Warwick Roman Completions 2 pair with both MidCon gatekeeper roles. The connected VNDRLY account exposes sites 399–401 only; MidCon/Warwick searches returned no rows. No live topology or visits were changed.
2. Database verification resolved locally: PostgreSQL 17 was downloaded from the signed Debian snapshot into /tmp, extracted under the current user, and started only on 127.0.0.1:55432. The repository fresh-local wrapper created a brand-new random *_test database and passed schema drift validation. Saved setup progression, automatic ticket/history/replay, rollback, future shifts and current membership authorization now have real SQL integration evidence. Runtime variables for recovery are in ignored .local/midcon-test.env; never point them at a shared database.
3. COI clarification resolved: the user meant Certificate of Insurance (COI), not a separate ROI document. Next Steps now offers a direct private COI upload to the current company administrator. A saved upload completes that prompt regardless of approval/expiry review; existing capability-specific insurance rules remain separate and general setup stays available. The actual browser upload, private storage bytes/owner, company save and prompt disappearance now pass against the local app: see [COI acceptance](coi-local-acceptance.md).
4. Changed signed-in measurement resolved locally; production-scale timing remains unmeasured. The local company is synthetic and Vite/parallel validation affect timing. Geographic Mapbox basemap/pin rendering also remains unverified locally because no Mapbox token is configured. Saved Gate Map location/destination text was checked in Chromium.

The full web run passed 2,325 tests across 431 files; later affected-suite checks cover the final helper settlement update. The existing Gate duty/admin/notification fixtures were updated to represent real approved commercial setup and scheduled ticket reuse; their 48 tests pass.

Implementation can continue from this branch without restarting. Live customer acceptance is not complete: the actual MidCon configuration still needs access through an authenticated service. The Supabase connector returned the same authentication prompt twice, without project data.

Final continued regression checkpoint: 193 API tests across nine suites passed against the fresh local target; API and web typechecks passed. The assigned-admin helper case and whole-card settlement case also pass targeted checks. No push or deployment was performed.
