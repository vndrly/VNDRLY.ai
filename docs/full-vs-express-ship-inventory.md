# Full Ship versus Express Ship — inventory

Requested comparison: exclude the ChatGPT plugin; compare existing Full Ship with John's Express Ship definition: **Commit → Push → Deploy → OTA → TestFlight**. Inspection only; no release or workflow changes performed.

## Result

Both cover the same seven publication tracks: commit, push, web, API, Supabase, OTA, and TestFlight. Deploy contains web/API publication and required database/storage updates. There is no additional non-plugin publication destination in Full Ship.

Express Ship is currently a user-defined command, not a separately implemented repository command. No Express Ship definition was found in AGENTS.md, docs, scripts, package.json, or GitHub workflows during this inspection. The existing handoff validator still requires exactly eight tracks. This report does not silently change that validator or the release rules.

Ratings below are engineering judgments about criticality to a correct release, not measured failure probabilities. 100% means essential to the stated outcome; 0% means no value as a routine extra release step. Conditional ratings depend on the changed code.

## Track mapping

| Express command | Existing publication track | Missing from Express? |
|---|---|---|
| Commit | Save scoped changes in Git | No |
| Push | Publish committed changes and advance main without force | No |
| Deploy | VPS/web | No |
| Deploy | API deployment and health verification | No |
| Deploy | Required Supabase migrations/storage provisioning | No |
| OTA | Production iOS over-the-air update | No |
| TestFlight | Native build and submission to Apple | No |

## Supporting work explicitly documented in Full Ship but not separately named in Express

Absence from Express's five command names does not establish removal from the underlying workflows. These are not extra publishing tracks.

| Element | Criticality | Assessment |
|---|---:|---|
| Check scoped changes and current remote main before publishing | 100% | Needed to publish the intended work without overwriting another change. Fits inside Commit/Push. |
| Required typechecking and relevant tests for changed code | 90% | Important readiness work. Existing fast-path instructions place it in logical development batches and reuse valid results. A known failure must not be hidden. |
| Repeat unchanged, already-passed broad checks | 0% | Existing fast path already prohibits duplicate verification merely because a commit/branch changed. |
| Locale parity checks | 80% when localization changes | Development validation, not a separate update destination. |
| Database/API integration checks and migration rehearsal | 95% when those behaviors change | Useful before a database/API release; not a reason to replay unrelated suites for a cosmetic change. |
| Work Hub route, privacy, feature-flag, mobile navigation and provider-readiness checks | 90% when affected | Documented feature checks; targeted readiness work rather than unconditional product exploration. Some route wording in the release document is stale. |
| Confirm live web/API and intended release commit | 100% | Part of a successful Deploy; a dispatched job alone is not completion. |
| Check OTA compatibility and confirm actual publication | 100% | Already inside OTA workflow. Workflow success can mean incompatible OTA was skipped; that is not an actual OTA publication. |
| Verify native build identity and actual TestFlight submission | 100% | Already inside TestFlight workflow; prevents submitting an old or incorrect build. |
| Persist release authorization, commit, job IDs and checkpoint | 85% unattended | Avoids losing progress and duplicating jobs. Supporting bookkeeping, not another user command. |
| Structured handoff validator and detailed blocker records | 60% | Helps detect incomplete records; cannot independently prove the release happened. Current implementation is incompatible with seven-track scope because it requires eight. |
| Concurrent monitoring, log inspection and necessary failed-step retry | 100% when failure occurs | Necessary to finish the requested operation. Does not authorize unrelated repairs. |
| Timing records and detailed completion report | 40% | Useful accountability; does not publish anything. |
| Restart local development servers | 0% for online publication | Present in legacy ship-it.ps1. Local convenience, not a required online update track. |

## Long verification route: exists, but already prohibited as the deployment pathway

verify-release.yml provisions a test browser and fresh local PostgreSQL, runs static/locale checks, Redis integration, an independent API suite, migration rehearsals, the full test chain, and additional browser checks. It retains diagnostics and cleans up its temporary database service. Its timeout is 150 minutes; that is a ceiling, not an observed runtime for this report.

The independent API suite is followed by pnpm test, which includes API tests again; browser tests can also run through the full chain and an additional targeted browser gate. Repeating passing checks for an unchanged tree has **0% incremental criticality as routine release overhead**. Relevant validation itself remains important. The canonical fast path already says not to use this long workflow as the deployment route.

## Extra operations embedded in the shared Deploy workflow

These are not Full-Ship-only differences. Express would inherit them if it uses the same deploy-api.yml unchanged.

| Embedded operation | Criticality | Observation |
|---|---:|---|
| Dependency installation, build, exact commit checkout, restart and health check | 100% | Core deployment mechanics. |
| Long list of migration invocations on every API deployment | 100% for required new migrations; 20% incremental value for already-applied replay | Workflow calls the listed migrations each run. This inspection did not certify every migration's no-op behavior. |
| Audio service provisioning and assistant-discovery provisioning | Conditional, 80% for changes requiring them | Called by every API deployment, not selected by Express versus Full Ship. |
| Reapply provider settings and default feature flags | 20% as routine release overhead | Workflow rewrites selected transcription/provider settings, removes a natural-voice user restriction, and adds some enable flags when missing. This is configuration work beyond copying code; no credential values were read or changed in this inventory. |
| Seed company/fleet workflow data | 0% as a generic publication requirement | Explicit apply command exists in API deploy. Actual necessity and no-op behavior were not audited here. |
| Synthetic Go company provisioning, duplicate-station cleanup/retirement and observation | 0% as a generic publication requirement | Embedded in API deploy. Comments describe prior authorization and no-op/one-shot behavior; this report does not independently verify those claims. |
| Conditional demo-database parity migration | Conditional | Runs when a demo database is configured. Not a separate publishing track. |

## Implementation mismatches

1. The documented fast path and legacy `save`/`ship it` script are different workflows. package.json maps both aliases to ship-it.ps1, which runs a local workspace typecheck, commit/push, direct deployment, live check, native build/submission, then local-server recovery. It does not explicitly orchestrate OTA or the separate API workflow. It is not an implementation of the five-command Express Ship definition.
2. A push to main automatically triggers web publication; API publication uses path filters. Consequently an explicit Deploy must account for already-running jobs and dispatch API when needed. This is configured automation, not a separate user command.
3. OTA already includes shared/mobile typechecking and mobile tests. Express does not remove those simply by using the word OTA.
4. TestFlight includes authentication, exact-build verification and build evidence retention. These are part of that command's existing successful pathway.
5. Current handoff validation requires eight tracks; Express's seven-track definition has not been implemented there.

## Sources inspected

- AGENTS.md (supplied project instructions)
- docs/release-fast-path.md
- package.json
- scripts/ship-it.ps1
- scripts/publish-online.ps1
- scripts/deploy.mjs
- scripts/release-handoff-gate.mjs
- .github/workflows/publish.yml
- .github/workflows/deploy-api.yml
- .github/workflows/mobile-ota.yml
- .github/workflows/mobile-testflight.yml
- .github/workflows/verify-release.yml

This is a static workflow inventory, not a claim that these jobs ran during this inspection or a new verification of prior deployment results.
