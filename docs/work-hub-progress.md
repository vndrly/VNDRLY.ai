# Work Hub release complete

Verified September 9, 2026, 14:44 UTC. The approved Work Hub expansion is deployed, and iOS 1.0.2 build 166 is available for internal TestFlight testing.

## Source and deployment identity

- Current main and local implementation branch: **abb82e811b43e93036c4e46dc6c33c52b4a3b757**.
- Application release: **76db4fc009fdf77416f77c1285a6c22021f1f905**. Native build and OTA use this exact commit.
- Later commits **0ae510e0** and **abb82e81** change only the VPS relay startup script and two migration entrypoint imports. Git diff confirms web, mobile, API runtime code, dependencies and schemas are identical to application release 76db4fc0.
- Source is available on main and codex/work-hub-expansion. This codex/work-hub-handoff-20260909 branch remains a documentation checkpoint, not the application checkout.

## Terminal release evidence

| Track | Verified result |
|---|---|
| Commit / push / main | Non-force publication; local branch fast-forwarded to abb82e81; unrelated local work preserved |
| Web | [Publish 34364345130](https://github.com/vndrly/VNDRLY.ai/actions/runs/34364345130) succeeded; public root and gate HTTP 200; signed-in Work Hub rendered with zero browser errors |
| API | [Deploy API 34364345208](https://github.com/vndrly/VNDRLY.ai/actions/runs/34364345208) succeeded; VPS exact SHA abb82e81; health HTTP 200 with status ok |
| Database / storage access | All additive migrations completed, including collaboration, finance, calls, scheduling and file library; access hardening verified two restricted roles and 161 RLS tables; existing storage retained |
| Internal audio relay | Existing VPS hosts relay; real off-server forced-relay UDP and TCP each sent/received/echoed all 5 messages; connected relay pairs verified |
| iOS OTA | [34363524030](https://github.com/vndrly/VNDRLY.ai/actions/runs/34363524030) succeeded; production runtime 1.0.2; [update group 65d5efbe-59bc-4f06-b6e8-55f07b2bafc8](https://expo.dev/accounts/vndrlyadmin/projects/vndrly-mobile/updates/65d5efbe-59bc-4f06-b6e8-55f07b2bafc8); iOS update 01a08692-170f-7171-a2be-d78fffbfa06d |
| Native build | [ad3b1962-ce9a-4677-b3d1-7c569568b9f6](https://expo.dev/accounts/vndrlyadmin/projects/vndrly-mobile/builds/ad3b1962-ce9a-4677-b3d1-7c569568b9f6), FINISHED, iOS 1.0.2 (166), production, exact commit 76db4fc0; verified artifact 10109428598 |
| TestFlight submission | [34363527714](https://github.com/vndrly/VNDRLY.ai/actions/runs/34363527714) succeeded using exact build ID and --wait; [submission 7b90a236-640f-4a4c-8e7d-9d26a0755919](https://expo.dev/accounts/vndrlyadmin/projects/vndrly-mobile/submissions/7b90a236-640f-4a4c-8e7d-9d26a0755919) uploaded successfully at 14:38:44 UTC |
| Apple processing | Direct App Store Connect verification at 14:44:24 UTC: build d44dab0e-40a9-4bd0-977e-6c0f8a981b74, version 166, processingState VALID, internalBuildState IN_BETA_TESTING, expired false. External beta state READY_FOR_BETA_SUBMISSION; no external review or App Store sale action performed |

Verified final web/API deployment completed about 9 minutes 14 seconds after release publication began. Internal TestFlight readiness was confirmed about 19 minutes 22 seconds after that start. Two deployment failures were diagnosed and repaired: first-start relay listener readiness, then redundant nonexistent migration imports. No credentials were rotated and no database reset was performed.

## Verification

[Complete application CI 34363491692](https://github.com/vndrly/VNDRLY.ai/actions/runs/34363491692) passed in one run: full workspace typecheck and locale parity, shared libraries, web 155 files / 981 tests (3 skipped), mobile 105 files / 684 tests, API 299 files / 2382 tests (53 skipped), and all 36 browser workflows. API also passed independently of the root test chain. Local verification covered final permission, replay, privacy, invoice/refund and recording regressions.

Two real browser clients accepted an internal call, joined and unmuted through the actual interface, and exchanged 49/50 inbound/outbound audio packets with connected peers. Calls recording remained disabled. Synthetic microphone hardware was used; signaling and media were real. Production relay tests separately forced actual relay connections over both transports. Final migration entrypoints executed twice each on an isolated local database (10/10). Deployment-script syntax, readiness failure/success cases and workflow contracts passed.

A redundant final-commit CI run may still be completing; application evidence above applies because subsequent changes contain only the separately verified deployment/migration fixes. Local logs and synthetic artifacts are retained in artifacts/work-hub-verification and excluded from source control.

## Delivered scope and configuration boundaries

See the [approved design](superpowers/specs/2026-09-09-work-hub-expansion.md) and [implementation plan](superpowers/plans/2026-09-09-work-hub-expansion.md). The release includes Crews/Channels, invited chat and internal calls, voicemail, consented meeting recording, activity/announcements, files/versions/sharing, notes/tasks/forms, calendar/Meetings scheduling, invoice and payroll preparation, explicit delegated permissions, imports/exports and appropriate mobile participation. Employee payroll documents are recipient-only and require actual issued provider documents; none were fabricated.

Card/ACH collection, payroll direct deposit, tax calculation/filing, secure bank/tax onboarding and Microsoft connection require their external configuration. These actions remain explicitly unavailable until configured and do not simulate successful money movement or filing. Voice transcription uses the existing configured transcription service; internal live audio requires no external calling provider. Physical microphone/headset acceptance remains a device test, distinct from automated native tests and TestFlight readiness.

## Safe cross-machine continuation

Fetch main and inspect local status before continuing. Preserve each machine's local work. The home checkout retains the pre-existing deleted button shortcut and artifacts/list-one-verification; neither was included in this release. Do not reset a checkout to this documentation-only branch. Never wipe/reset production or development data, rotate canonical credentials, or force-push. Screenshots and their business contents were not copied into repository fixtures or documents.
