# Release fast path

This is the canonical agent workflow after implementation is complete and the
exact release tree has passed its required validation. Development, debugging,
and TestFlight build time are measured separately from commit/push/web deploy.

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
5. In parallel, monitor the GitHub run and any path-eligible Expo production
   OTA workflow.
6. When the deploy job succeeds, verify the public route and confirm that the
   deployed bundle belongs to the intended commit when the change affects
   client assets.
7. Report the commit, workflow link, public result, and commit-to-live elapsed
   time immediately.

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
- A new native TestFlight binary is a separate, explicitly authorized track.
  Start it after the web publication is underway or complete, then monitor its
  build and App Store submission independently.
- Native build duration and Apple processing time are never counted against
  the 10-minute web release target.

## Failure handling

At the first failed or stalled boundary, retrieve its logs and identify the
root cause. Safe corrections and retries continue under the original release
authorization. Do not repeat successful earlier stages, test unrelated
subsystems, or ask the user to approve the same release again.

If public verification has not succeeded by 15 minutes, provide a concise
status update naming the blocked stage while continuing the authorized repair.
