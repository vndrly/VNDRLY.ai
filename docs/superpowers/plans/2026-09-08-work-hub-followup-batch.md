# Work Hub Follow-up Batch

## Goal

Ship the approved Work Hub and shared-UI follow-up across web and iOS.

## Tasks

- [x] Temporarily remove 1099 onboarding steps, blockers, and user-facing reminders on web and iOS while retaining the underlying reporting implementation behind its existing feature controls.
- [x] Make AskV voice state read `Mute` on the green active pill and `Unmute` on the red muted pill; route sign-out to the relevant sign-in page.
- [x] Finish Channels UX: keep the conversation hidden until selection, allow organization administrators to soft-delete a channel after confirmation, and expose audited actions to administrators.
- [x] Lay out Calendar as a two-thirds calendar plus one-third Create Shift card on desktop, stack on small screens, and verify Publish Shift end to end.
- [x] Replace the native file picker chrome with one branded Choose File pill, show a filename only after selection, and verify upload prerequisites and errors.
- [x] Add a scoped Gate Supervisor role that can manage gatekeeper tasks, shifts, calendars, and staffing without organization-wide administrator authority.
- [x] Apply the shared modal background at natural proportions with its fade ending around two-thirds down the reserved header/logo region.
- [x] Remove the duplicate organization logo from the employee modal body/photo area and align its account actions in one responsive row; brand ordinary actions and retain red destructive actions.
- [x] Audit modal actions so ordinary mutations use the active organization brand, while warning/destructive/status colors retain their semantic meanings.
- [x] Run focused tests using red-green TDD, then all mandatory repository validation gates. Reconciled on 2026-09-09: locale parity, whole-tree typecheck, shared-library, web, mobile, isolated API, and Chromium E2E gates pass on the corrected Work Hub tree.
- [ ] Full ship: commit, advance main without force, publish web, deploy API with guarded migrations, verify production data services, publish iOS OTA, and submit the native build to TestFlight.

## Reconciliation

The original implementation plan retained unchecked development steps after the corresponding commits landed. Those stale boxes are not an implementation backlog. The current source-to-design status, remaining external gates, and fresh validation evidence are recorded in `docs/work-hub-batch-reconciliation.md`.
