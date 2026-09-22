# Gate Operations Command Center Design

## Status and relationship to earlier designs

Approved through the September 22, 2026 Gate review and the user's final
authorization to continue unattended through a successful TestFlight build.
This design extends the September 18 and September 20 Ask V Gate contracts and
the existing Change Over implementation. Where this design conflicts with the
single-operator Change Over ledger, this design supersedes it with independent,
multi-person duty sessions. The earlier rules for permission checks, concise
voice behavior, confirmation evidence, idempotency, audit, GPS-derived site
context, and non-destructive migrations remain in force.

## Goal

Make Gate a fast, complete operating workspace for a staffed field entrance.
Work Hub remains the sole schedule authority. Gate records who is actually on
duty, supports overlapping workers, exposes current and historical operations,
and keeps coverage, attendance, reports, exceptions, and handoffs auditable.
Ask V is an operating layer over those same services: it acts first, speaks
briefly, and never gains authority beyond the signed-in user.

## Core model

The system separates five concepts that must not be conflated:

1. **Scheduled assignment**: who Work Hub expects, at which site and gate,
   during which time, required staffing count, and work-start policy.
2. **Travel status**: a worker is on the way, optionally sharing a live ETA;
   this does not mean the gate is staffed.
3. **Paid work session**: the worker's compensable clock. It begins on site or
   during paid travel according to the vendor policy copied to the assignment.
4. **Gate duty session**: the worker has explicitly assumed a gate and can
   perform Gate actions. Several people may be on duty at one station.
5. **Handoff**: immutable notes, follow-ups, and snapshot facts exchanged
   between shifts. A handoff does not own or replace the duty roster.

Each event records the acting user, organization context, site, station,
timestamp, origin (web, mobile, Ask V, or system), and relevant reason.

## Work Hub scheduling and staffing

Gate scheduling lives only in Work Hub. A Gate assignment stores or references:

- site and gate station;
- assigned worker or open shift;
- start and end time;
- required staffing count for the station and period;
- work-start policy: `on_site` or `paid_travel`;
- coverage requirement and current Gate coverage status.

The vendor chooses a default work-start policy. An authorized scheduler may
override it per shift because contracts can differ within one vendor. Work Hub
shows the policy on the assignment so the worker knows when the clock begins.

Coverage is measured against active Gate duty sessions, not logins or travel
status. Zero active workers when one or more are required is **uncovered**.
Some, but fewer than the required count, is **understaffed**. Meeting or
exceeding the required count is **covered**.

## Duty, attendance, and handoff

`Assume Shift` creates an independent Gate duty session for the signed-in user;
it never displaces another worker. An admin in Gate Mode uses the same action
under their own identity. Check-ins, check-outs, reconciliations, and notes are
audited to the worker who actually performed them.

An individual sign-off ends only that user's duty session. Other active workers
continue without interruption. Formal handoff remains available during overlap.
When the last active person leaves an operational gate, the handoff flow is
required so unresolved facts are preserved, but joining or overlapping duty is
not blocked by a handoff.

A missed scheduled assignment remains an attendance exception even if another
person restores coverage. A shift supervisor or admin resolves it as:

- No show;
- Excused; or
- Reassigned.

The original assignment, actual coverage, resolution reason, resolver, and time
remain in the audit trail. A late worker may subsequently assume duty; their
actual work start is retained.

## Work-start and location policies

### On-site start

An explicit action or ordinary-language command such as “I'm on site, start my
shift” starts the paid work session and Gate duty together at the assigned gate.
When worker, assignment, and gate are unambiguous, Ask V executes without a
second submit question and briefly confirms success.

### Paid-travel start

An explicit action or command such as “Start my day” starts the paid work
session before arrival and begins authorized location tracking. The worker is
`en_route`, not on Gate duty, until they arrive and Assume Shift. Arrival and
duty are separate audited events.

Live trip sharing is explicit. It stops automatically when the worker assumes
the gate, ends the work session, or cancels the trip. The system retains work
events and ETA/status evidence required for operations and audit, not a
permanent breadcrumb route. Live location is visible only to the worker, active
Gate supervisors, and authorized vendor admins.

If location permission or GPS is unavailable, the requested paid start is not
blocked. It becomes a tracking exception visible to the worker, supervisor, and
authorized admin. They are notified until tracking resumes, and the audit log
records failure and restoration. A worker may supply a manual ETA; mobile may
calculate an ETA after explicit location sharing and offer navigation.

## Coverage alerts and restoration

After a ten-minute grace period from scheduled start, uncovered or understaffed
Gate coverage creates or updates a Work Hub coverage gap. Alerts go immediately
through in-app notification, mobile push, and email to:

- each missing scheduled worker;
- Gate supervisors; and
- authorized Midcon admins.

Reminders repeat every ten minutes while the condition remains. “On my way” and
ETA responses are shared upward but do not satisfy coverage. When enough people
Assume Shift, the gap is resolved and the same recipients receive a restoration
notice. Notification and email jobs are idempotent and persist their delivery
attempts, preventing duplicate fan-out after retry or restart.

The existing general notification-email stub is replaced by real SendGrid
delivery using the established transport and production health checks. Coverage
email is not considered verified until a non-sandbox production-safe delivery
path and audit record are confirmed.

## Gate Coverage Status

Each station has a staffing requirement status:

- Active;
- Paused until a date;
- Paused indefinitely; or
- Closed.

Pausing preserves schedules, history, and Gate tools but suppresses coverage
requirements and alerts for the pause window. It records who changed the status,
why, and optional automatic reactivation time. An authorized person may still
Assume Shift and process unexpected visitors while paused. Closing is a distinct
administrative state and does not erase records. Individual scheduled shifts may
also be canceled or marked not required with a reason.

Gate supervisors and authorized admins manage coverage status. Ask V exposes
the same permission-checked action. A complete explicit command containing the
station, state or end date, and reason executes immediately; Ask V asks one
short question only for a missing material value.

## Admin Gate Mode

Authorized vendor admins receive a `Gate Mode` entry from the regular VNDRLY
workspace. It enters the same Gate shell without impersonation or a second
login. `Return to Admin` exits the Gate workspace without ending the account
session.

Viewing Gate Mode does not put an admin on duty. `Assume Shift` starts their own
duty session alongside anyone already working. While on duty, the admin can use
the normal Gate functions permitted for Gate supervisors, and every action is
recorded under that admin's identity.

## Dashboard, navigation, and controls

Dashboard remains the default for gatekeepers and Gate supervisors. Navigation
order is Dashboard, Work Hub, Gate, History, Shift Notes. The sign-out control is
labelled `Change Over / Sign Out`. It is gray normally and becomes amber ten
minutes before that signed-in worker's scheduled end, remaining amber until
their duty session ends. No matching schedule leaves it gray and available.

Dashboard snapshot counter cards are gray-bordered interactive controls that
use the organization brand on hover. Each opens History with Current Shift and
the corresponding record filter. Snapshot counter borders use the branded
visual language, and the follow-up card is named `Shift follow-ups` with `Open
items` and `Resolved items` views.

The shared top Ask V control and Gate sidebar control use one mute and panel
state. Either control opens or focuses Ask V and toggles mute. Labels and colors
remain synchronized: gray and `Unmute Ask V` while muted, branded and `Mute Ask
V` while active. A compact shared waveform appears beside the header control
and below the Gate microphone, animating only for user or assistant speech and
respecting reduced-motion settings.

The New Gate Entry `Check in visitor` action alone uses dark-gray, unshadowed
text over its amber hover state for legibility. Other amber buttons do not
inherit that exception.

## History, current occupancy, and reconciliation

Gate History defaults to Current Shift. Its range choices are Current Shift,
Previous Shift, Last 24 Hours, 7 Days, 14 Days, 30 Days, 90 Days, and 1 Year.
Its record selector supports check-ins, check-outs, visitors on site, employees
on site, vehicles on site, pending admission, and Needs Review. Search and every
export use the same selected range, record type, site, gate, and search query.

Live on-site filters include records opened before the selected period that are
still active. Historical list filters use their true event timestamps. Dashboard
links and direct History navigation use the same query contract so displayed
counts and rows agree.

Expired or old visits are no longer silently auto-checked out. They remain open
and appear in Needs Review. A gatekeeper may reconcile a stale record as
confirmed no longer on site only after entering a reason. This removes it from
live occupancy without inventing an exact departure time and records a distinct
reconciliation event. Gate supervisors and admins may reverse a reconciliation;
ordinary gatekeepers may not. Reversal restores the prior operational state and
retains both events in the audit trail.

## Shift Notes, exports, and secure delivery

Gate History and Shift Notes use matching large white, branded cards. In each,
Site and Gate appear first; PDF, Excel, Word, and Email controls follow; search
and date range come next; results are contained within the card. Compact fields
use the branded white pill inputs and selects. Result rows may use smaller cards
with a light-gray hover.

Reports are generated server-side from the same authorized, filtered dataset
shown on the page. The selected range may be a full year. Email sends a secure
sign-in link rather than attaching personal Gate data. Access is rechecked when
the recipient opens the report.

The recipient selector defaults to the sender and permits multiple eligible
users; no arbitrary external address is accepted in the first version. Eligible
recipients are revalidated at send time:

- Midcon admin and office users with site access may receive the full report;
- managed-subcontractor admin and office users receive Gate History restricted
  to their own company's visits; and
- managed-subcontractor recipients receive Shift Notes only with explicit
  site-wide report permission.

Each delivery records sender, recipients, report type, filters, scope, and
access outcome. Ask V may set filters, prepare or generate authorized reports,
and email them to eligible recipients using the same service.

## Ask V toolbox and behavior

Ask V receives permission-scoped tools for every Gate operation in this design,
including:

- start paid travel or on-site work, share ETA, stop work, Assume Shift, and
  individual sign-off;
- inspect schedules, staffing, attendance, coverage gaps, and duty roster;
- classify attendance exceptions when authorized;
- update Gate Coverage Status and cancel a coverage requirement;
- perform fast check-in/check-out, plate OCR resolution, and Gate history search;
- set History and Shift Notes filters, generate reports, and deliver secure
  report links to eligible recipients;
- list Needs Review records, reconcile with a reason, and reverse when authorized;
- manage shift follow-ups and handoff notes; and
- open or focus the corresponding web or iOS surface.

Ask V uses common language rather than exact phrases. Explicit, unambiguous
commands are the confirmation for their exact action. She acts before speaking,
does not lecture about capabilities, does not insist on optional fields, and
does not ask for a second submit. She asks at most one short question when a
material identifier, date, reason, recipient, or authority boundary is missing.
Success is one brief factual acknowledgment.

All actions call the same services as the UI. Server authorization, current
organization and site context, idempotency, audit, report scope, and confirmation
evidence remain authoritative. New executable language is added through a
tested intent corpus rather than uncontrolled production self-learning.

## Data and migration strategy

Use additive, guarded migrations only. Preserve existing Gate shifts and
handoffs by introducing independent duty-session and status records rather than
destructively rewriting history. Backfill existing active single-operator
shifts into equivalent duty sessions once, idempotently. New columns are nullable
or have safe defaults until application compatibility is deployed.

Expected additive concepts include station coverage status, Work Hub Gate
assignment metadata, duty sessions, travel/work sessions, attendance exceptions,
tracking exceptions, reconciliations and reversals, notification delivery state,
and report-delivery grants/audit. Exact tables and indexes are fixed in the
implementation plan after schema inspection. No DROP, TRUNCATE, force push,
restore-over-live, or destructive schema synchronization is permitted.

## Verification

Tests must cover:

- multiple simultaneous duty sessions and independent sign-off;
- last-person handoff enforcement without blocking overlap;
- required staffing, uncovered and understaffed transitions, grace and reminder
  timing, restart-safe idempotency, restoration, and pause behavior;
- attendance exception resolution and audit;
- on-site and paid-travel clocks, arrival, ETA, location permissions, tracking
  exceptions, and location visibility;
- Gate Mode access without impersonation;
- History range/type/search parity with Dashboard counts and every export;
- live occupancy across range boundaries;
- stale record reconciliation and supervisor/admin-only reversal;
- secure report scopes, recipient eligibility, link access recheck, and audit;
- real notification-email invocation and production configuration health;
- Ask V ordinary-language variants, role boundaries, one-question maximum,
  immediate execution, concise output, idempotency, and web/iOS parity;
- synchronized Ask V UI controls, waveforms, accessibility, and branded layouts;
- locale parity, typecheck, web, API, mobile, and browser end-to-end suites.

## Release contract

After the exact tree passes verification: commit, push, non-force advance main,
run guarded production migrations with API deployment, publish and verify web,
verify API health and email readiness, publish the production iOS OTA, then run
the native TestFlight build and submission. Completion means Apple has accepted
the build submission into TestFlight processing; App Store public release is not
part of this authorization.

