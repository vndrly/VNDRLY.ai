# Recent web-to-iOS UI parity — 2026-10-22

Scope: the recent CompanyGo/Fleet UI upgrades through Work Hub, Calendar, Gate and Gate Dashboard. Adapt existing server-backed workflows to native controls while retaining company branding, account permissions, cameras, offline journals, background location consent and existing dispatch/run behavior.

| Surface | Native result |
| --- | --- |
| CompanyGo / Fleet | Retains existing company operations choices, grouped Dispatch/Fleet Readiness, canonical detail/action flows, driver-binding recovery and automatic mileage. Expanded/selected control state is now exposed accessibly. No replacement dispatch state machine. |
| Work Hub | Preserves Today, Communications and Tasks & Forms. Adds account/company-specific native workspace links and scoped expandable Workforce: on shift, on call/unavailable, authorized employee profile/message links, coverage candidates, offer status and recipient acceptance/decline. An offer never assigns a worker. Lost responses recover the exact journaled request and canonical receipt. |
| Calendar | Compact At a glance above the existing calendar; actual personal next shift, meeting, due tasks and unread conversations. Expandable source-aware details; existing project milestones with 30/60/90-day range and read-only details. Existing month/date navigation artwork, filters, scheduling, merged sources and timezone semantics retained. English/Spanish UI and bounded-source notices. |
| Gate | Authoritative Site/Gate selectors above entry form, unlabelled GPS arc around gate selector, no Selected Location summary. GPS evidence never overrides authorized scope or blocks a permitted entry. Arrivals / On Site / Departures share a compact card; independent refresh, real ETA only when available, brief new-leg alert respecting reduced motion, canonical visit/run details, explicit checkout separate from detail opening. Existing camera, plate, admission, visitor, queue and voice flows retained. Watch mini-card sits with title; duty strip remains separate. |
| Gate Dashboard / handoff | Compact Watch, Tasks, Gate activity and On site panels, one handoff desk for carry-forward actions, notes, saved briefing and incoming acknowledgment. Saving notes does not assume watch or end a paid shift. Stale briefing cannot be assumed. Supervisor recovery retains reason, eligible replacement, original-request recovery and server authorization. Gate duty details remain accessible by disclosure. |
| Gate Map / History | Add gate uses the server-authorized management-site discovery and existing create endpoint on Map only. History accepts validated site/station/range/type routes after authorized discovery. |
| Account changes | New scoped reads include actor, active membership and authentication generation. Detail/disclosure state resets on sign-out, membership change and same-account reauthentication. Durable action recovery remains attached to stable actor/company identity. |

## Intentional platform differences

- Web-only administrative destinations without native equivalents are not represented as dead native controls.
- Native project timeline displays existing authorized milestones; project creation stays on its existing supported surface.
- Native camera, background tracking, device consent, offline queue and permission prompts remain on their current native paths.
- Unavailable GPS, source failures and partial data are shown honestly; no synthetic ETA, roster, project, visit or task is substituted.
- The matching ChatGPT plugin package retains existing identity, tools, views, branding, five service skills and account grants; native UI parity does not silently expand tool scopes.

## Validation and release evidence

Focused regressions cover handoff save/assume separation and stale review, abandoned-watch recovery, native history filters, scoped record reads, refresh behavior, arrival alerts, scope reset, workforce offer recovery, task navigation, calendar summaries and Spanish UI. Full validation logs and the final eight-track release receipt are kept under `.local/releases/ios-parity-*`.

Physical iPhone camera/permission/background delivery acceptance is separate from software/build validation. No physical-device acceptance is claimed by this audit.
