> Implementation update: the Gate-only pages and workflow fixes are now implemented. See [release checkpoint](gate-only-ios-release-checkpoint-2026-11-14.md) for verified workflows, remaining device checks, and shipping results.

# Gate-only iOS: page map and workflow gaps

Reviewed November 14, 2026 against checkout `0b1fabe76a95439d489e32d0893378433693121d`.

This is a source-grounded composition and implementation scope, not a claim of device acceptance, implemented fixes, or App Store submission. The checkout was clean at the start of review. Existing audit documents supply historical context; their test counts and deployment statements are not current-release evidence.

## Product boundary and John's corrections

Keep VNDRLY's existing app identity, shared records, company branding and web universe. First iOS publication focuses on Gate operations for gatekeepers, gate supervisors and administrators. Exclude Fleet and Field product experiences from this release, on iPhone and iPad. Keep the essential Work Hub and administrative functions that let those people finish Gate work inside the app.

John selected the web Gate Dashboard, Gate page, Gate Map, Gate Log and Handoff Notes as the foundation. Build outward only where a workflow cannot finish within those five surfaces.

John clarified: assigning someone **to a site** means authorizing their access to that site. Use one control and the existing site-access record. Do not add a second site-assignment record or require a second authorization switch. Shift scheduling is a different action, and an actual watch begins only when the operator assumes it.

## Availability correction — November 14, 2026

John removed personal-calendar availability conflict resolution from the Gate release scope. Calendar appointments and availability entries are informational; no recorded available window is required and a personal appointment must not deny Gate staffing. Keep the records for later Work Hub redesign. Site assignment/access remains one switch. Actual assigned-work overlap, role/site authority, qualifications and other existing staffing policy are separate checks. This supersedes the availability-blocker recommendations in the original review below.

## Recommended navigation

The five primary destinations are **Dashboard / Gate / Map / Log / Handoff**. They are stable across all three roles. Role and current server capabilities change the cards and actions inside them. Use the approved pill/button family and existing branding.

Work Hub, My Profile and authorized Administration are secondary destinations reachable from a consistent header/menu. A notification bell opens the inbox. AskV remains a readily reachable assistant control; Gate voice remains prominent on the Gate page. Neither consumes a sixth navigation destination. On iPad use the same destinations in the adaptive sidebar and arrange cards in columns; do not restore the full web product merely because the screen is larger.

Every operational page displays selected company, site and gate, plus the actual operating watch when it differs from the viewed gate. Reading another gate, opening a map pin or paging records must never transfer watch authority.

## Primary page and card map

Cards are listed in recommended reading order. Existing native code means a reuse candidate, not a completed device workflow.

| Page | Card order and actions | Web source | Native starting point | Composition still needed |
|---|---|---|---|---|
| Dashboard | Company/site/gate context; workday and watch status; My Watch and next watch; coverage alerts; activity/on-site totals; unresolved items and priority tasks; handoff preview | `pages/gate-change-over.tsx`; `gate-watch-summary`, `gate-watch-radar`, `gate-my-watch-schedule`, `gate-activity-card`, `gate-dashboard-live-summary`, `work-hub/dashboard-tasks` | `(tabs)/change-over.tsx` delegates to `GateChangeOver`; `GateOperatingContext`, `GateSiteGateSelect`, `WorkdayControls`, `GateDutyCard`, `WatchPassControl` | Compose the web summary/radar/task cards into native sections. Link each total to the scoped Log or Gate list. Put full handoff editing on Handoff. Show supervisor coverage across authorized gates, without changing the operator's active gate. |
| Gate | Context and watch prerequisite; New Entry with camera/voice/manual input; Arrivals; On Site; Departures; linked-area movement where applicable | `pages/gatekeeper.tsx`; `gate-arrivals-panel`, `gate-area-traffic`, `gate-memory-input`, `gate-recognition-photo` | `(tabs)/gate.tsx`, `GateArrivalsCard`, `GateAreaTraffic`, `GateIdentityDocument`, native gatekeeper adapter | Make entry/list/detail transitions explicit. Preserve drafts while reviewing a match. Expose missing authority, stale reads and pending sync instead of an apparently empty gate. Gate arrivals may consume external run facts without opening Fleet dispatch. |
| Map | Site/gate selector; map with status markers; selected gate detail sheet; staff visibility; current activity; history/time controls where already supported | `pages/gate-map.tsx`; `gate-coverage-map`, `gate-map-*` | `(tabs)/gate-map.tsx`, native Mapbox integration and selection store | Map web popup/hover actions to tap sheets. Preserve inactive linked-gate markers in grey. Provide View Gate, View Log and Directions with the same scope. Place configuration under authorized edit actions, not ordinary marker selection. |
| Log | Filters; totals; paged rows; crossing/visit detail; entry/exit originals; authorized export/share | `pages/gate-history.tsx`; `gate-report-toolbar`, `gate-history-record-details`, `gate-visit-details` | `(tabs)/gate-history.tsx`, `GateHistory`, `GateHistoryCalendar`, `TicketGateProof` | Ensure every detail opens in-app and returns to the same filters/page. Label current internal-area movements separately from historical filters unless they actually share the query. Verify multi-image evidence presentation and native export. |
| Handoff | Current watch identity; outstanding people/vehicles; open items; note editor; prepared turnover review; acknowledge/assume flow; previous notes | `gate-handoff-desk`, `gate-recent-shift-notes`, `gate-shift-notes-list`, `pages/gate-change-over.tsx` | `GateChangeOver`, `(tabs)/shift-notes.tsx`, `GateAssumeWatchFlyout`, `WatchPassControl` | Separate outgoing preparation from incoming acknowledgment. Preserve the reviewed revision. Show seven days by default with older history accessible. Keep acknowledgment distinct from merely viewing a note. Put Switch User after the outgoing save/turnover state is known. |

### Supporting pages required to close the loops

These are nested pages or sheets, not additional primary tabs. Proposed destinations can reuse current route names; avoid duplicate implementations.

| ID | Destination / entry | Essential contents | Role / completion |
|---|---|---|---|
| S01 | Assume Watch, from Dashboard or uncovered gate | Review previous handoff, current watch owner, site/gate, eligibility and GPS result; explicit assume | Authorized operator, including supervisor/admin acting as operator. Saved watch readback establishes coverage. |
| S02 | Entry review, from Gate camera/voice/arrival | Company, driver, plate/state, purpose, notes, host/destination, original evidence and correction controls | Operator with current authority. Saved visit ID; recognition alone is not admission. |
| S03 | Visit detail / checkout, from Gate or Log | Correct visit, current state, entry evidence, departure notes/photo as supported, movement history | Authorized operator. Saved departure clears the correct on-site record; historic detail remains readable. |
| S04 | Shift note detail, from Handoff or Dashboard | Author/time/gate, full note, open items, viewed state, applicable acknowledgment | Authorized reader; saved acknowledgment belongs to the correct incoming user. |
| S05 | Staffing / schedule, from Dashboard coverage card or admin menu | Calendar, gate shift creation/edit, assigned people, availability, open shift response and replacement | Supervisor/scheduler when authorized. Saved shift and assignment, followed separately by actual watch coverage. |
| S06 | Person / site access, from Staffing or Administration | Existing person, Gate role(s), one site-access switch per authorized site, account/login state, relevant credentials | Authorized access manager. Switch ON means assigned/authorized at site; switch OFF removes that site's access subject to server rules. Preserve other sites and roles. |
| S07 | New staff / account activation, from People | Existing-person search before creation; identity/contact, role/site access, login activation state | Authorized admin. Saved person and linked usable account, or an explicit activation waiting state. Do not label an unlinked person ready to assume watch. |
| S08 | Gate/site configuration, from Map edit or Administration | Name, coordinates/geofence, active state, site linkage and linked-gate/area relationships | Authorized gate editor. Saved configuration and refreshed map/selector. Admin company context is explicit. |
| S09 | Gate company/site service setup, from Administration | Gate contractor relationship, Gate service and rates where required by operational ticket generation | Authorized owner/admin. Existing assignment/catalog contract; do not expose general marketplace browsing. |
| S10 | Gate billing / watch ticket detail, from Administration | Existing Gate billing panel, correct ticket status, watch/period/evidence, permitted corrections and relevant exports | Financially authorized admin; supervisor only if granted. Keep broad accounting and payment operations outside first scope. |
| S11 | Work Hub home | My schedule, Gate tasks/forms, messages, attention/safety and relevant files | All roles, scoped to authorized Gate work. Each card opens an actionable record. |
| S12 | Task/form detail | Assignee, due date, instructions, draft/submit/complete, saved status; supervisor assignment where permitted | Worker own work; manager allowed team scope. Native task/forms components already exist. |
| S13 | Messages / thread | Gate team/company communication, exact conversation, attachments and reply | Authorized participants. Retain existing messaging rules and MidCon hold; opening a thread does not authorize outbound notifications. |
| S14 | Safety report / review | Report, supporting photo, receipt, supervisor response where authorized | Worker submit; supervisor/admin review. Keep emergency guidance accessible even if a network request fails. |
| S15 | Files / credentials | Relevant company/site documents and existing personal credentials; upload/expiry/review where needed | Server-authorized access. Split from general inventory/equipment management. |
| S16 | My Profile / edit / settings | Photo, name, contact, language, password, company context, credentials, work-phone/location/audio settings, privacy/support/account controls | Own user. Gatekeepers must not be pushed into broad Field onboarding or company operations selection. |
| S17 | Notifications / pending sync | Exact permitted record destinations; delivery preferences; pending/failed operation detail and retry | Own user, role-scoped. No Field/Fleet deep-link escape; pending is never displayed as saved. |

Work Hub meetings/calls can remain only when needed by an existing Gate task and their native flow is complete. General training/course progress, inventory, managed crews, payroll processing, service marketplace, Fleet runs and Field ticket creation are outside the initial navigation. This does not delete shared backend records or remove those functions from the web app. Gate-generated billing tickets remain in scope; their existence does not require exposing the Field product.

## Workflow continuity matrix

| Journey | Route through the app | Required prerequisite / saved finish | Hole to close or prove |
|---|---|---|---|
| First login | Login/activation → Profile essentials → Dashboard | Active account and membership, Gate permissions, authorized site | Gate-scoped onboarding and useful no-site state; no redirect to Field home or Fleet. |
| Assign person to site | Staffing/People → person → site-access switch | Existing `/people/:id/access` record updated and read back | Port current web access model; do not create a parallel assignment concept. Refresh eligible candidates afterward. |
| Schedule that person | Dashboard coverage → schedule → gate/time → candidates → save | Site access, required credentials and valid staffing policy | Candidate list must explain blockers and link back to the exact person's access/profile/availability fix. Preserve shift draft on return. |
| Begin work/watch | Dashboard → workday as appropriate → Assume Watch → Gate | Current eligibility and reviewed handoff; saved watch | Workday, duty, scheduled shift and watch are related but distinct. Do not show coverage from a schedule alone. |
| First-time visitor/vehicle | Gate → entry → review → confirm → On Site | Complete required fields and saved visit | Company creation/selection, purpose/notes, driver fields and rejected uploads need end-to-end proof. |
| Returning vehicle, different driver | Gate → plate lookup → company recall → choose/correct driver → confirm | Explicit driver for this crossing | Prevent last-driver recall from becoming an unreviewed identity assertion; constrain driver suggestions to company. |
| Expected arrival | Gate Arrivals → review → prefill → confirm | Authoritative visit saved with allowed association | Do not navigate to Fleet to complete Gate admission. Preserve arrival paging, truncation disclosure and human confirmation. |
| Internal gate movement | Gate On Site → choose destination → record movement → destination confirmation | Saved movement with correct crossing authority | Shared linked-site presence must not become a duplicate site admission; full exit uses checkout. |
| Departure | Gate On Site/search/voice → exact match → checkout → Log | Correct open visit transitioned; evidence retained | Multiple matching names/plates require selection. Retry must not create duplicate departure. |
| Handoff | Handoff → save notes/open items → prepare → incoming login/review → assume | Correct users, reviewed version and saved watch transition | Unsaved notes, stale preparation, absent relief and concurrent takeover all need explicit recovery. |
| Abandoned watch | Dashboard/Map → gate → supervisor recovery | Server authorization, reason, expected watch and replacement | Native recovery code exists; prove reachability and receipt after interrupted response. Do not silently overwrite. |
| Coverage gap | Dashboard alert → Staffing → eligible replacement → saved schedule → later watch | Assignment first; real coverage only after assumption | MidCon hold means alerts cannot depend on outbound notification delivery. Show the state in-app. |
| Task or incident | Dashboard/Hub → exact task/report → save → return | Saved task status or report receipt | Scope Next Steps to real unfinished actions, maximum five; exclude course-progress suggestions. |
| Gate configuration | Map/admin → gate editor → review → save → map | Authorized site/company and saved station version | Role wrapper currently excludes some intended users; linked topology must work on phone. |
| Logs/proof/report | Log → filters/page → detail → export/share → back | Same scope and retained evidence | Verify populated results, not only empty-state rendering. Page state survives detail navigation. |
| Offline/reconnect | Gate draft/observation → pending queue → retry/reconcile → saved record | Original operation identity; current authority rechecked | Pending offline observation cannot be represented as approved admission; account switch cannot leak/replay another user's queue. |
| End work/switch user | Handoff/watch state → End Duty/workday where applicable → logout | Explicit saved transitions and cleared private context | Logout must not silently end workday, abandon watch or lose unsubmitted evidence. |

## Site assignment/access: one control

Use the existing web `EmployeeAccessEditor` and `StaffProfileDialog` model: `operationalRoles` plus `siteLocationIds`. The web saves access with `PUT /api/vendors/:vendorId/people/:personId/access` and loads eligible sites from `/api/vendors/:vendorId/people-access`.

Recommended label: **Assigned sites** with a concise explanation, “Enabling a site authorizes this person to work there.” A site switch is the assignment/access operation. Gatekeeper versus Gate supervisor remains a role/permission choice. A scheduled shift adds date/time/gate; Assume Watch records actual operating responsibility.

The editor must preserve assignments to other sites and unrelated existing roles. Only show sites the acting user may grant. A scheduler without access-management permission gets a specific blocked state, not an automatic permission escalation. After an authorized change, reload staffing candidates before assignment review. Do not grant all company sites as a shortcut.

Removing a site must account for current watch and future shifts using existing server rules: show affected work and the actual allowed transition. Never assume that deleting one access entry also cancels shifts or ends a watch. Keep this distinction visible in the same person panel.

## Confirmed source gaps and implementation priority

P0 means required before claiming this Gate release is workflow-complete. P1 is presentation/integration work that must be finished for any included surface. Verification items are not proven defects.

| ID | Priority | Evidence in current source | Required work |
|---|---|---|---|
| G01 | P0 | `lib/app-navigation.ts` and `(tabs)/_layout.tsx` still build Fleet/Field navigation; `isGatekeeperRouteAllowed` explicitly allows Fleet routes and all nested Work Hub routes. Root `_layout.tsx` imports Fleet background integrations and handles Fleet pushes. | Apply a release-specific Gate scope at all entry points: navigation, direct routes, push, search, AskV/client intents, shortcuts and background startup. Keep web/company entitlements unchanged. A hidden tab is insufficient. |
| G02 | P0 | `gateLandingRoute` returns general tabs for non-gatekeeper roles; root guard gives supervisors the gatekeeper route set. That set does not include `employees`, `employee`, `gate-billing`, `site-gate-contractors` or `add-site-location`. | Build a capability-aware Gate route matrix for all three personas. Allow only needed supporting pages; preserve server authorization. Test redirects for supervisor and admin separately. |
| G03 | P0 | Native `app/employee/[id].tsx` uses a legacy role array without `gate_supervisor`; web has separate operational roles and site access. | Port the current staff access/profile contract. Site assignment is the one authorization switch John described. Include usable account state and credential prerequisite links. |
| G04 | P0 | `components/profile/GateLocationsCard.tsx` returns null for non-vendors and for both Gate roles before loading `canManageGateLocations`. | Expose gate editing according to actual capability and active company context. Platform admin and authorized supervisor cannot be blocked solely by that wrapper. Do not grant supervisors configuration rights they do not have. |
| G05 | P0 | `lib/gate-shift-assignment.ts` requires `recorded_available`, no warnings and no override. Server `gate-shift-assignment-policy.ts` rejects recorded conflicts but does not universally require that exact availability state, and handles an overtime-only warning differently. | Updated by John: remove the personal-calendar availability blocker from server, web and iOS. Missing/recurring availability and appointments do not deny assignment. Keep unrelated eligibility checks. Do not build an availability conflict-resolution workflow for this release. |
| G06 | P0 | Profile exposes onboarding, company operations, marketplace, services and broad native operation controls. Work Hub `files-notes` mounts `EquipmentWorkbench` and combined `FilesInventory`. | Gate-scoped Profile and Work Hub composition. Split relevant documents/notes from general equipment inventory; restrict nested routes as well as links. |
| G07 | P1 | Web Dashboard imports task, watch-summary, live activity and handoff panels. Native `GateChangeOver` primarily composes workday/duty/watch, snapshot, notes and recovery. Earlier readiness audit explicitly leaves radar/task layout mapping. | Finish Dashboard composition and move full note workflow to Handoff without duplicating its saved state. Use disclosure/detail sheets to keep phones usable. |
| G08 | P1 | Web note-view acknowledgment uses `IntersectionObserver`; readiness audit calls out native visible-item tracking. Native handoff preparation and assume commands already exist. | Verify/map native note viewed state, incoming acknowledgment, retained revision and Switch User return flow. Reading is not turnover acceptance. |
| G09 | P1 | Native Gate map, log, evidence and movement components exist; earlier readiness audit leaves some popup/gallery/card composition and physical checks unresolved. | Complete tap targets and evidence/detail navigation; verify current implementation before replacing anything. |
| G10 | P0 verification | `employees.tsx` converts individual roster request failures into empty arrays and depends on `vendorId`. | Distinguish unavailable roster from no people, provide retry, and handle platform-admin company context. Otherwise staffing can appear impossible without explaining why. |
| G11 | P0 verification | `app.json` still names the app `VNDRLY Field Mobile`, includes Fleet/Field permission copy and declares tablet support. Search of native app/components/lib found no obvious account-deletion entry under common deletion names. | Align name, purpose strings, advertised functionality and screenshots with Gate. Audit actual account lifecycle and deletion support; search absence is not proof that no backend exists. Test iPad too. Preserve bundle identity. |
| G12 | P0 verification | Prior audits explicitly do not certify physical camera/microphone/GPS, offline persistence, sharing or every role's writes. | Run the acceptance matrix on the final native candidate. Existing unit tests and successful TestFlight submission cannot substitute for actual workflows. |

## Pagination and return-navigation rules

Page composition and record pagination are different concerns. Preserve site/gate IDs independently of each list's page/cursor. Change a filter → reset the list page; shrinking results → clamp page. Open a record → retain filters, scroll and originating page. Back returns to the source list, including when opened from Dashboard counts.

Existing audit records 25-row web Log and 50-row native Log pages. Reuse working implementations; do not impose matching page sizes as a prerequisite. Arrivals must expose all available pages and explicitly disclose server truncation. Notes default to seven days but permit older records. Staff and site pickers need search and access to all eligible results, not a silent first-page limit. A missing record, revoked permission or expired link needs an in-app explanation and a safe scoped return.

## What can actually be reused

React DOM cards cannot be pasted as JSX into React Native. Reuse their visual composition, copy, state transitions and contracts; use existing native renderers wherever present. Shared `@workspace/gate-booth`, `@workspace/api-zod`, plate-state logic and native adapters are the established reuse boundary. Keep camera, microphone, GPS, file export and background handling in native adapters. No new framework or external dependency is necessary for this proposed scope.

Keep company branding, approved Rivet/AskV artwork, backgrounds and branded controls. Do not make a new simplified visual identity. Preserve MidCon vendor1054's notification hold; a staffing assignment, test, release or switch change is not permission to resume it.

## Implementation order and acceptance evidence

1. Gate release boundary and role routing: all three personas land correctly; excluded routes cannot reopen through indirect entry points.
2. Staff/site access/profile: one assignment/access switch, correct Gate roles, account activation and prerequisite feedback; prove personal-calendar availability is not an assignment prerequisite.
3. Dashboard + Handoff: full start/watch/turnover/recovery journey, with separate saved workday/duty/watch states.
4. Gate: manual entry first, returning driver, camera/voice correction, arrivals, movement and checkout, with original evidence and safe retry.
5. Map + Log: same scope, inactive linked gates, detail navigation, populated paging, file sharing and originals.
6. Essential Work Hub + admin: schedule, tasks, communication, safety, files, gate configuration and Gate billing. Cut remaining broad-product links.
7. Exact-candidate native acceptance and App Store package. Use established release scripts when publication is requested; this document is not a full-ship command.

For each included write workflow record persona/company/site/gate, starting record state, action, returned receipt/ID, subsequent readback and expected denial case. Test gatekeeper, Gate supervisor, company admin and platform admin with explicit company context. Admin ability to view is not proof of an operator's authority to write.

Device cases: small iPhone keyboard and sheets, supported iPad orientations, camera denied, microphone denied, inaccurate/unavailable GPS, airplane mode, interrupted upload, termination/relaunch, session expiry, company/account switch, competing watch takeover and repeated submission after an unknown response. Use controlled test records and non-destructive fixtures; never use live MidCon shifts as incidental test data. No reset/reseed is authorized by this scope.

## App Store completion boundary

Market this as the Gate-focused VNDRLY app and show only included capabilities. Supply working review access and a safe way to exercise gated workflows without requiring the reviewer to be physically at a customer's gate. Review support must not bypass production geofences or permissions. Provide accurate privacy/support links, data disclosures and permission descriptions. If account creation is supported, users must be able to initiate account deletion in the app; confirm the exact lifecycle before submission. Keep chat's applicable moderation/reporting controls in the scope check.

Apple references checked November 14, 2026:

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/): completeness, accurate metadata, functionality and privacy.
- [Account deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion).
- [Review access and information](https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review/).

App Store approval is Apple's decision. No build, TestFlight upload, review submission or public release was performed in this scope review.

## Source reference index

All paths below are relative to the project root.

- Web core pages: `artifacts/vndrly/src/pages/gate-change-over.tsx`, `gatekeeper.tsx`, `gate-map.tsx`, `gate-history.tsx`.
- Web card directory: `artifacts/vndrly/src/components/`; staff source: `staff-profile-dialog.tsx`, `employee-access-editor.tsx`.
- Native pages: `artifacts/vndrly-mobile/app/(tabs)/`; Profile editing: `app/edit-profile.tsx`; staff: `app/employees.tsx`, `app/employee/[id].tsx`.
- Native navigation: `artifacts/vndrly-mobile/lib/app-navigation.ts`, `lib/mobile-viewer.ts`, `app/_layout.tsx`, `app/(tabs)/_layout.tsx`.
- Native composition: `artifacts/vndrly-mobile/components/GateChangeOver.tsx`, `GateDutyCard.tsx`, `GateShiftAssignments.tsx`, `GateDailyBillingPanel.tsx`, `profile/GateLocationsCard.tsx`.
- Work Hub: `artifacts/vndrly-mobile/lib/work-hub-mobile.ts`, `app/(tabs)/work-hub.tsx`, `app/work-hub/[module].tsx`, `components/work-hub/`.
- Assignment policy: `artifacts/vndrly-mobile/lib/gate-shift-assignment.ts`; `artifacts/api-server/src/services/gate-shift-assignment-policy.ts`.
- Previous inventories: `docs/gate-card-ios-readiness-2026-11-12.md`, `docs/gate-mode-card-audit-2026-11-12.md`, `docs/next-steps-helperflow-inventory.md`, `docs/native-ios-release-readiness.md`.
