# Release fast path

This is the canonical agent workflow after implementation is complete and the
exact release tree has passed its required validation. Development, debugging,
and TestFlight build time are measured separately from commit/push/web deploy.

## Deploy command boundary — updated 2026-10-24

John explicitly prohibits using the long `verify-release.yml` cycle as the deployment pathway. Batch necessary validation during development and reuse valid evidence for unchanged code. A deploy command uses the optimized publication and live-verification path; it must not launch a serial, duplicate whole-repository verification cycle as its normal prerequisite. Keep heavy validation in the cloud and run independent checks concurrently where safe.

If readiness is incomplete or a known failure blocks release, immediately identify the specific blocker and required affected checks. Do not bypass a known failure. Save progress independently. Report completed/total stages and running/pending stages, and include total time since the deploy request alongside publication time so verification delays are not hidden.

For ordinary web/API deploys, monitor only those requested tracks. The additional mobile and plugin tracks below apply to an explicit full ship or separate authorization.

## Work Hub release checks

- Confirm the public root renders the commercial homepage while login, signup, legal, portal, and deep links remain direct.
- Confirm authenticated `/work-hub` uses focused navigation and “Back to VNDRLY” restores the prior route.
- Run `migrate:work-hub-flags`, `migrate:work-hub-core`, `migrate:work-hub-domains`, and `migrate:work-hub-notifications` in order.
- Verify `/api/healthz`, flag-off opaque responses, and the public AskV privacy/rate-limit boundary.
- Confirm iOS signed-out launch routes to sign in, Work Hub deep links resolve, and exit returns to the main tabs.
- Treat audio and Microsoft 365 as unavailable unless their provider readiness checks pass.

## Service target

| Checkpoint | Target from release start |
| --- | ---: |
| Commit and publish branch plus `main` | 0–3 minutes |
| GitHub production build and VPS synchronization | 2–7 minutes |
| Public route verified from the deployed commit | 10 minutes maximum |
| Automatic blocker investigation already underway | 15 minutes maximum |

The measured baseline on 2026-08-26 was substantially faster:

- Remote commit accepted: `23:47:25Z`
- Public verification completed: `23:49:02Z`
- Commit to verified production: **1 minute 37 seconds**
- GitHub workflow: **1 minute 13 seconds** total
- Production build job: **48 seconds**
- VPS deployment job: **19 seconds**

## Preconditions

- The working tree is scoped and reviewed.
- Required validation has passed for the exact tree being released.
- Remote `main` has been read immediately before publication.
- No destructive database operation, force push, or credential rotation is
  part of the release.

The release clock starts after these conditions are satisfied. A test failure
or unfinished implementation is development time, not web deployment time.

## One-pass release

1. Record the release start time and exact local tree.
2. Create one auditable commit for the scoped change.
3. Use the GitHub integration first. Publish the feature branch and advance
   `main` without force from the current verified remote parent.
4. Let `.github/workflows/publish.yml` build and deploy the web application.
5. In parallel, monitor web Publish, API Deploy with guarded migrations,
   production Expo OTA and native TestFlight build/submit. Include the matching
   VNDRLY ChatGPT plugin package and MCP deployment in the same full ship.
6. When the deploy job succeeds, verify the public route and confirm that the
   deployed bundle belongs to the intended commit when the change affects
   client assets.
7. After API deployment, rebuild and submit the updated VNDRLY ChatGPT plugin
   using its existing identity, as explicitly directed by John.
8. Synchronize the canonical local project and local `main` to the final shipped
   commit. Reconcile leftover changes, then rebuild/restart web, API and iOS web
   preview from that checkout. Inspect process provenance and artifacts, and
   verify the rendered web and mobile pages. Do not reuse a healthy stale process.
9. Report the commit, all workflow results, public checks, Expo update group,
   TestFlight submission, plugin version and submission evidence, public plugin
   review status, local synchronization results, and commit-to-live elapsed time. A web-live update may be
   reported immediately, but is not full-ship completion.

## Validation reuse

Do not repeat an unchanged full test suite merely because the release moved
from a feature branch to `main`. Verification is reusable only when the tree is
identical. Any conflict resolution, merge edit, generated-file change, or
release fix creates a new tree and requires the affected validation again.

Database-backed API tests remain mandatory when API or database behavior
changes. Their execution belongs before release start and must use the isolated
test database described in `AGENTS.md`.

## Mobile release tracks

- A fingerprint-compatible production OTA runs alongside the web deployment.
  It does not delay reporting that the web release is live.
- Every full ship includes a new native TestFlight build and submission under
  standing authorization. Start it alongside the other release tracks; do not
  ask again whether it is included.
- Native build duration and Apple processing time are never counted against
  the 10-minute web release target.

## ChatGPT plugin release track

- Release the matching MCP tools, embedded views, skills, manifest, branding
  and package. Record the package version and source commit.
- Rebuild and submit the updated plugin to ChatGPT using its existing identity.
  Do not create duplicate catalogue entries. Preserve existing permissions.
- John's explicit correction excludes updating his personal installed instance
  or reconnecting its account. Do not make those steps release prerequisites.
- Record the package version, release commit, and actual submission result.
  A built ZIP or healthy API is not a completed submission.
- Distinguish submitted, approved and publicly available status. OpenAI review
  is external; pending approval does not mean publicly available and is not
  an additional full-ship completion requirement.
- Full ship requires TestFlight submission and the matching plugin submission,
  together with all other mandatory tracks in AGENTS.md.

## Local synchronization — mandatory full-ship track (2026-10-31)

Full means every required update path is operationally synchronized to the same
final shipped commit. Publication from a worktree must also update the canonical
local project. Never leave local `main` behind remote `main`, preserve stale source
over the release, or call a partially updated installation a full ship.

After reconciling the local checkout, restart web `http://localhost:5173/`, API
`http://localhost:8080/api/healthz`, and iOS web preview `http://localhost:8081/`
with its API proxy. Preserve unrelated work outside the release checkout, without
discarding it or presenting it as shipped. Concurrent new development means this
checkout is no longer an exact release snapshot and cannot pass completion.

Record `tracks.local_sync.verification` with:

- `checkout`: canonical absolute project path; `commit` and `remoteMain`: exact
  final release SHA; `trackedChanges` and `untrackedFiles`: inspected empty arrays.
- `syncedAt` and `checkedAt`: ISO timestamps in execution order.
- `services.web`, `services.api`, `services.ios`, and `services.proxy` (port 8099): each contains `checkout`,
  `commit`, inspected `pid`, `startedAt` after synchronization, `checkedAt`, `url`,
  `httpStatus: 200`, `sourceProof` (process/source and build report), and
  `artifactSha256` (the inspected served bundle or rebuilt API artifact).
- Web and iOS also require `browserProof`: a report/screenshot of the actual
  rendered page checked against the release. A login screen proves only login
  rendering, not an authenticated changed page such as Gate Map.

Inspect these facts before recording them. The gate validates the evidence
structure and commit equality, and its completion command re-reads local HEAD,
origin/main and working-tree status to reject a stale clean receipt. It cannot
independently certify remote deployment or rendered-browser claims.
Changing the final release SHA invalidates old evidence for every track. Refresh
affected deployments and local services before claiming completion. Never edit
an earlier authorization or historical ledger to pretend it included new evidence.

## Failure handling

At the first failed or stalled boundary, retrieve its logs and identify the
root cause. Safe corrections and retries continue under the original release
authorization. Do not repeat successful earlier stages, test unrelated
subsystems, or ask the user to approve the same release again.

If public verification has not succeeded by 15 minutes, provide a concise
status update naming the blocked stage while continuing the authorized repair.

## Mandatory unattended handoff gate

`Full ship` is a command to execute and monitor every required track until the
gate passes. An explicit plugin exclusion leaves eight required tracks, including
TestFlight and local synchronization. Preserve the exact user command in
`authorization.instruction`, omit the plugin from `authorization.scope` and
`tracks`, and record it under `excludedTracks`. The gate rejects any attempt
to waive an included track via ledger edits, or to report completion while work
remains runnable, queued, or unverified.


Keep `.local/release-state.json` as the single recovery checkpoint. Start from
`docs/release-state.example.json`; never overwrite an existing checkpoint on
recovery. Record the exact user authorization and restrictions, request time,
deadline (if supplied), release commit, actual verification evidence, each
track's next action, and active workflow/session IDs. Do not store secrets or
raw credential-bearing logs. An unknown deadline must remain null, not invented.

The nine track IDs are `commit`, `push`, `web`, `api`, `supabase`, `ota`,
`testflight`, `plugin`, and `local_sync`. Each is `pending`, `running`, `blocked`, or `verified`.
Evidence entries contain `source` (workflow URL, report path, or live check),
`observedAt` (ISO timestamp), `commit`, and `result` (what was actually confirmed).
For verified tracks, the evidence must prove that track's completion criteria
in the full-ship checklist above, not merely that work started.

For a blocked track record `reason`, `attempts` (evidence),
`alternativesConsidered`, and `requiredExternalChange`. Record why each supported
alternative cannot proceed within the existing authorization. A prerequisite
block must name that prerequisite and its evidence. Do not mark a running build
blocked just because it is taking time. Keep working on every independent track.

Before a voluntary final release handoff:

```sh
node scripts/release-handoff-gate.mjs .local/release-state.json complete
# Only if all remaining work genuinely cannot proceed:
node scripts/release-handoff-gate.mjs .local/release-state.json blocked
```

Both commands fail closed on missing records/evidence, wrong release commits,
active jobs, pending/running tracks, or runnable next steps. `complete` requires
9/9 verified. `blocked` requires at least one documented blocker and every other
track verified or independently blocked. A passed blocked gate is NOT success.
Do not change status merely to pass the gate. Verify external facts first.

Recovery order: read authorization and scope; inspect every active job; record
new results; continue the next authorized action. Do not repeat approval requests
or rebuild an existing release. Record total elapsed request-to-now time as well
as commit-to-live time. Do not hide an exceeded deadline by restarting the clock.

The validator is a local workflow guard, not a platform-level ban on ending a
turn. It does not grant permissions, execute releases, poll jobs, or validate
remote evidence automatically. User pauses and involuntary interruptions retain
the checkpoint and do not require a false blocked/completed status.
