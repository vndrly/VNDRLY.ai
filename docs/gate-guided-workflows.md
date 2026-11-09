# Gate guided workflows

askV owns these workflows; Next Steps is her prioritized queue and visual guidance surface. They share one active workflow and the same saved company, site, station and shift. A how-to question can offer that workflow, and a follow-up about the current step retains the current form and control guidance. Opening or closing chat or the Next Steps list does not restart the workflow.

Text and natural voice receive the same bounded Gate guidance context from the existing provider, without another summary request. The context describes the current screen and possibly unsaved form progress; it cannot grant access or prove completion. The read-only `query_gate_setup_progress` tool reuses the authenticated saved summary and exposes only Gate setup progress. `offer_gate_workflow` lets askV propose any registered Gate workflow using exact context IDs; the client supplies its own registered route and requires the user's explicit Start or Resume. An explicit setup resume rechecks saved state before selecting the current remaining step. A saved watch awaiting its automatic ticket resumes a waiting state, never another Assume Watch. Generic follow-up and resume offers use an actual registered workflow; unsupported functions do not acquire invented helpers.

Gate helpers use the saved company, site, station, shift and vehicle context. The navigation Next Steps button is beside the notification bell. Its themed panel shows at most three unfinished, applicable workflows, grouped by Gate function and ordered by priority. Training courses and certification requirements are not in this queue.

Selecting a workflow opens a separate branded helper. Clicking outside the selection panel or its X closes that panel while guidance continues. The helper has its own Stop X; stopping keeps saved work. The exact next available control gets a pointer-transparent ring and arrow. Show me scrolls explicitly; guidance never clicks, selects, assumes watch or saves for the user. Motion preferences disable pulses. Missing, disabled, hidden or ambiguous controls are never guessed from text. Inside a guided modal, the helper remains inside its accessible boundary so Show me and Stop stay usable. Starting another page is disabled until the form is closed; drafts and existing dirty-close confirmation remain intact.

## First watch

Start from the saved prerequisite that actually blocks the watch: an authorized Gate site and station, direct or contracted employee with site access and a login, station shift, eligible assignment, then Assume Watch. There is no separate Start Ticket action. Company service or authorization blockers are shown as waiting/review states. A saved watch without a confirmed automatic ticket never asks the worker to assume again. Only the saved watch and ticket complete this workflow.

Station setup coaches the existing authorized-site selector and actual gate editor, review and explicit Confirm & Save. It cannot manufacture partner sites or company permissions. Direct and contracted employee paths open the existing profile and managed-employer forms; they reuse their actual access, enrollment and validation controls. Scheduling uses the real Add/Edit Shifts and reviewed assignment controls.

## Daily Gate work

The pages expose Gate-specific guide actions beside their existing operations. Ask V how-to questions also offer Start guided helper for these same registered workflows; starting guidance requires the explicit click.

- Restore gate staffing: review the saved incident, explicitly acknowledge if currently authorized, then assign or personally cover the saved watch. Actual saved coverage resolves the incident.
- Prepare and receive watch handoff: preparation and outgoing signatures do not claim incoming coverage. The incoming gatekeeper must save their own watch with its automatic ticket.
- Check in a vehicle: confirm physical gate, plate and person, then explicitly save the existing form.
- Confirm an inner arrival: choose the saved vehicle and confirm actual physical arrival.
- Check out a vehicle: an inner departure waits for the outer colleague; only saved outer checkout closes the property visit.
- Early turnaround: saved outer checkout cancels a still-pending inner arrival, preserving a concurrently confirmed arrival.
- Return to the inner gate: a saved re-entry after prior entry and departure clears obsolete outer departure. Routing intent alone cannot complete it.
- Read Gate Map and Gate Log: compare recorded confirmed location with intended destination, then inspect event history. These are not live vehicle GPS. This read-only guide has no completion receipt.
- Schedule and assign a gate shift: save the station definition, then review and save an eligible assignment. Scheduling does not start a watch.

Repeated workflows stop being automatically suggested after three independently saved completions for that user and company. Openings, clicks, guided runs and replayed records do not count. Saved receipt verification is company/site scoped and cannot grant business access. On-demand guidance remains available after mastery.

## Staffing alerts and temporary office coverage

One staffing episode has one shared incident. The first current owning-company admin to explicitly confirm acknowledgment wins; all admins see that saved name/time. Login, reading a card and scheduling do not acknowledge. Reminders and the red pulse stop for everyone after acknowledgment; red unresolved coverage remains until a saved watch actually restores staffing.

The bell and Watch Radar open the exact saved calendar site, station, shift and date. Future warnings do not claim the booth is empty now. Calendar allows an authorized admin or office worker to review and personally Assume Watch using existing Gate rules. Saved temporary coverage grants only the exact station's operational scope; no permanent role is changed. Returning to Admin or Work Hub keeps the watch active. Explicit handoff/release changes custody.

MidCon vendor1054 remains indefinitely paused until John explicitly resumes. There is no automatic expiry, release-triggered resume or startup backlog release. Staffing facts remain available neutrally during the hold. Physical push/SMS delivery is not asserted by UI tests. Signed SMS reply activation and provider limitations are recorded in [twilio-staffing-inbound-readiness.md](twilio-staffing-inbound-readiness.md).

## Verification

The broader web suite passed2,390 tests across437 files. Focused subsequent Gate helper/control, station, scheduling and account-context tests passed; final web/API/mobile typechecks were performed separately. Real Chromium evidence covers two-admin shared acknowledgment, reduced motion, exact calendar context, neutral held-company behavior, the separate persistent helper, real direct/managed forms, pointer-transparent actual control guidance and390px layout. Business flow acceptance uses isolated real PostgreSQL; no live customer vehicle movements, watch assumptions or test notifications are created.

The current signed-in enabled/disabled comparison, raw request accounting and limits are in [gate-helper-performance.md](gate-helper-performance.md). Deployment outcomes and exact-release evidence are recorded in the ignored release ledger rather than claimed from build dispatch.

Final additional checks:25 real Radix modal/target tests passed, and the390px actual first-name control remained unobscured and actionable after Show me. Broad API execution covered926 files (6,554 initial passes); all20 observed failures were resolved through32 current-source targeted cases on the same isolated database plus the successful501-activity stress rerun. Final account/helper57 and shared committed-event21 checks passed separately; no unresolved observed failure remains.
