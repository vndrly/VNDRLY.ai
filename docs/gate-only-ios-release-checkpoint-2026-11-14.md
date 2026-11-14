# Gate-only iOS release implementation checkpoint — 2026-11-14

The iPhone and iPad release is VNDRLY Gate 1.0.5. Fleet, Field and course/training navigation are excluded. The web application retains those modules.

## Pages and workflows

| Entry | Pages and functions | Roles |
|---|---|---|
| Dashboard | My workday, selected site/gate, active watch, saved next actions, watch coverage | All Gate users; coverage management for supervisors/admins |
| Gate | Assume-watch prerequisite, manual check-in/out, voice, plate capture, visitor evidence, offline Gate observations | Current authorized operator |
| Map | Authorized gates, on-duty personnel, selected gate, Gate/Log/Handoff links | Gatekeeper scoped sites; supervisors/admins authorized coverage |
| Log | Recorded entry/exit history, filters, history pagination | Authorized Gate users |
| Handoff | Watch review, saved handoff, oncoming assumption, follow-ups, recovery and user switch | Gatekeeper, supervisor, admin according to server authorization |
| Shift Notes | Seven-day default and older paginated notes | Authorized Gate users |
| Work Hub | Gate shifts, tasks/forms, safety, chat, calls, meetings, notifications | Active company and existing server permissions |
| Calendar | Create, reopen, staff, remove/reassign staff, reschedule and cancel a Gate shift; explicit review and saved-result verification | Supervisor/company admin |
| Profile | Edit contact/name/photo, credentials, company context, language, notification/privacy/device settings, sign-out | Signed-in users |
| First login | Required temporary-password replacement, token rotation, verified enrollment and return to handoff | Staff invited with temporary passwords |
| Administration | Staff, one site authorization switch, existing credentials, login provisioning, Gate setup/linked gates, documents, Gate rates and billing | Company admin; platform admin according to endpoint scope |
| Account | Privacy/support links, authenticated deletion request and platform review queue | Own account; queue only for platform admin |

## Confirmed fixes during local workflow runs

- Incoming login now opens the saved handoff instead of losing it to a second dashboard redirect.
- Incoming shift does not inherit the outgoing operator's editable notes.
- Saving a new scheduled shift keeps staffing controls available. Reopening a calendar record exposes staffing and schedule edits.
- Staffing loads saved assignments and supports reviewed removal of all staff. Actual shift conflicts and qualifications remain enforced; calendar availability is advisory.
- Site removal was being bypassed by an older primary-role fallback. Explicit role/site records now prevent that fallback; revoked sites disappear and direct access is denied.
- Supervisor profile saves use the same self-account authorization as profile reads. Account-only administrators can edit their own name/email/password without a field-employee identity.
- Empty employee job titles use the actual API contract. Profile and authorization saves remain separate with an honest partial-save message.
- Native staffing uses Expo's UUID implementation. Gate background sync preserves excluded custody drafts without replaying them.
- Local preview proxy now permits the existing device-source headers.

## Local acceptance evidence

All mutations used a new isolated PostgreSQL database with synthetic example.invalid users. Production operational records and notification settings were not used for workflow tests. The isolated preview uses Expo 18181, proxy 18099 and API 18080.

Verified through the app UI: company-admin login; selected-site watch assumption; manual vehicle entry and checkout; departed Gate Log record; saved handoff and user switch; incoming gatekeeper assumption; follow-up resolution; incoming supervisor handoff routing; Gate shift creation and reopening; staffing save/readback; reschedule from 06:00 to 07:00 in America/Chicago; removal of assigned staff; shift cancellation; supervisor profile editing; staff site authorization editing; physical gate creation; linking two authorized sites; retiring a physical gate and retaining its inactive linked indicator; phone and tablet responsive navigation. API readback additionally verified employee creation, site authorization, login provisioning, correct temporary-password flag, denied staff-management access for gatekeepers/supervisors, removed-site list filtering and direct removed-site denial.

The native iOS production JavaScript/Hermes export succeeded. Workspace TypeScript and focused Gate, handoff, calendar, enrollment, access, account-request and offline-journal regressions have passed in multiple checkpoints. Final suite and shipping outcomes are recorded below when complete.

## Validation limits and release follow-through

- Windows localhost runs the actual Expo application in its web target; it does not prove iPhone camera/OCR, persistent microphone, background GPS, push delivery, Face ID, CallKit or offline native storage on a physical device. These require the signed TestFlight binary and device checks.
- The local fixture deliberately has no external AI, Mapbox, telephony or outbound notification credentials. External-service behavior was not represented as tested.
- The first complete mobile suite exposed obsolete Field-home/profile expectations, which were replaced for the Gate release. A pre-existing Fleet offline-journal capacity stress test timed out twice; Fleet is excluded from this release, and that stress check is recorded separately from Gate validation.
- Account deletion requests are durable and visible to platform admins. Actual deletion remains a support-operated process; no automated erasure or completed App Store compliance review is claimed.
- Platform administration still respects company membership requirements of scheduling endpoints. Company administrators and Gate supervisors operate shifts in their active authorized company.
- MidCon notifications remain paused. No test resumption or live operational message was performed.

## Shipping result

- Mobile/application implementation commit: `8d1c445d57fb055ad3741364da6e52079bb1ed49`.
- Production build memory fix: `0abdcfae`; automated and isolated-demo migration fix: `7d864b5bc3cf003b22d4f06addb3d83618581151`.
- Web/API deployed successfully. Public homepage and API health return HTTP 200; authenticated login and Gate-site reads succeeded after the additive migration.
- GitHub Publish run [43577091703](https://github.com/vndrly/VNDRLY.ai/actions/runs/43577091703) and Deploy API run [43577091612](https://github.com/vndrly/VNDRLY.ai/actions/runs/43577091612) both completed successfully for the migration fix.
- EAS production iOS build [90c0a3d9-a031-443d-a3fa-5d0922750f95](https://expo.dev/accounts/vndrlyadmin/projects/vndrly-mobile/builds/90c0a3d9-a031-443d-a3fa-5d0922750f95) finished successfully: **1.0.5 (299)**, runtime 1.0.5, exact implementation commit above.
- Exact-build submission [5a135e3a-2995-4018-a60b-22e739e70937](https://expo.dev/accounts/vndrlyadmin/projects/vndrly-mobile/submissions/5a135e3a-2995-4018-a60b-22e739e70937) succeeded. Apple build `fc3e1dec-6713-4994-bae9-49e55dfac235` is **VALID**, **IN_BETA_TESTING**, and available to the existing internal Test group.
- App Store draft updated from 1.0.3 to 1.0.5; build 299 selected; description, promotional copy, keywords, subtitle, TestFlight notes, and reviewer instructions changed to Gate-only scope.
- **Public App Store release is not submitted or approved.** The current draft has no screenshot sets. Native iPhone/iPad screenshots are still required. Existing reviewer credentials were preserved and verified, but they are a platform-admin account. Older scoped demo credentials are stale; a dedicated restricted review login is recommended before public submission. Review notes direct any operational testing to the existing SYNTHETIC DEMO Gate Site, not live customer sites.

## Final test accounting

- Real workspace TypeScript and final mobile TypeScript checks passed.
- The final broad mobile run covered 352 files (excluding the unrelated Fleet journal capacity stress file): 350 passed; two failures were stale search expectations and an unrelated native calendar import in the file-isolation test. Both were corrected and rerun: **2 files, 16 tests passed**, including a new inventory-exclusion regression. Across the broad run and corrected reruns, all 352 included files passed (2,229 current tests). This is combined evidence, not a claim that the original broad command exited successfully.
- Deployment/TestFlight workflow checks: 10 passed; updated API deployment migration checks: 5 passed.
- Focused access revocation, handoff, profile, enrollment, staffing, account-request, and offline journal regressions passed as recorded above.
- The Fleet stress timeout remains documented; Fleet is excluded from the release.

## Open on this workstation

The isolated Expo preview remains at http://localhost:18181, backed only by synthetic records on API 18080 and proxy 18099. It is a local web-target preview of the actual Expo app. Install **1.0.5 (299)** from TestFlight for native hardware acceptance. The saved phone/tablet screenshots under `docs/release/` are preview evidence, not native-device acceptance or App Store screenshots.
