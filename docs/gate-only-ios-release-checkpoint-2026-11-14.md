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

Pending final commit, production deployment and signed iOS/TestFlight build verification.
