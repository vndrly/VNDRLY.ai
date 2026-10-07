# ChatGPT workflow parity expansion

This candidate is not a declaration of complete web/iOS or Ask V parity. The public package already in OpenAI review and its submitted version must be distinguished from this candidate. No new Fleet GPS or background collection is implemented here.

## Candidate changes

- Inventory workspace projects authorized asset records, custody holder, condition, return deadline and attention status. Exact plate, VIN, serial and tag lookup reuses the canonical asset alias lookup and owner checks. Asset history and mutations retain existing custody policies.
- `manage_ticket_record` prepares creation, edits, acceptance, denial, reinvitation, submission, approval, kickback, awaiting-payment, cancellation, administrator reactivation and line-item changes through the existing ticket endpoints. Current endpoint authorization and lifecycle rules remain authoritative.
- Ticket descriptors filter action choices by actor role; ticket writes require their separate scope. Partner review is not available to workers. Reactivation remains platform-admin-only.
- `record_ticket_payment` records an already-made payment through the canonical Accounts Payable endpoint, with new explicit `finance:write` consent. Existing grants do not inherit it; this tool never transfers money.
- ChatGPT ticket creation strips supplied location assertions and creates pending arrival. Creating a ticket never proves arrival or starts a location collector.
- Bound approval dispatch uses the typed-tool classifier, including ticket and asset capabilities. Durable action claims and saved results prevent approval retries from submitting a second change.
- `manage_gate_shift` adds duty/work-session completion and handoff preparation/cancellation. Exact session identifiers come from station state; incoming-worker authentication remains a trusted device flow. End-session routes reject a mismatched station.
- Carry-forward items can be opened, resolved and reopened through the same Gate write scope and saved-action authorization. Canonical execution rechecks the current station operator or supervisor and locks the station before validating the item's state; chat-supplied actor IDs cannot grant authority.
- Scheduling one crew member preserves existing assignments, acknowledgements and foreman fields. A locked roster check refuses stale additions/removals before applying any change. Field foremen and Gate supervisors retain the canonical ticket/site authority checks.
- VENDRY Fleet is an explicit disconnected extension placeholder. Existing authorized trip views remain available; tagged-vehicle tracking, load phases, missing-vehicle distance and navigation await the Fleet package.

## Completion still required

### Coordinated workday recovery requirement

V must turn a single multi-domain instruction into a shared, durable plan, rather than independent chats that lose dependencies. The user's unexpected-absence example is a required acceptance scenario. Specialist names select accountable toolsets; adding a specialist must not create permissions or imply a background worker already exists.

| Workstream | Responsible specialist | Required outcome and evidence |
| --- | --- | --- |
| Invoicing | Finn | Determine the last actually issued invoice within the selected company/customer scope. If older than 15 days, prepare eligible uninvoiced work and an itemized draft, flagging missing rates, approvals or billing rules. No invoice issuance or payment approval follows from a request to prepare. |
| Incoming communications | Work Hub communications specialist | Apply an authorized temporary availability message through supported channels, deduplicate replies and stop it on return or expiry. Do not disclose a doctor's appointment unless explicitly requested. Unsupported inbox monitoring must be reported. |
| Calendar recovery | Work Hub scheduling specialist | Resolve today/tomorrow and close of business using the user's timezone and company hours; identify movable commitments, travel and dependencies; propose or perform authorized moves and contact affected people. Track proposed, sent, accepted, declined and unanswered separately. A sent message is not agreement. |
| Payment review | Finn and field operations | Assemble tickets actually awaiting the user's review, with amounts, evidence and exceptions. Preserve individual ticket decisions in the return briefing for batch approve/disapprove; do not approve automatically. |
| Gate coverage | Gate and scheduling specialists | Find uncovered intervals at authorized contracted sites. Produce reachable, qualified candidates with availability and compliance evidence. Do not invent phone numbers, assign unavailable people or claim a candidate accepted. |
| Long-held equipment | Ivy | List equipment checked out longer than 90 days, current holder, checkout date, custody history, due date and condition. Separate unknown dates and unresolved custody rather than estimating them. |
| Available work | Field operations | Match current Hotlist jobs against the vendor's actual service catalog, approved relationships, capacity, geography and compliance. Return eligible opportunities and reasons; a match is not a bid or awarded job. |
| Verification and return briefing | V with Audrey | Read saved results after each change, preserve failures and pending responses, and put payment decisions first when the user returns. Include a recovery schedule through close of business tomorrow, with actual completion versus outstanding work. |

The plan needs operation identifiers, record references, assigned toolsets, prerequisites, deadlines, retry protection, checkpoints and cancellation. Independent reads can proceed together; dependent writes wait for their prerequisites. Scope and role checks remain authoritative on every action. Permission revocation, account/company switches and partial failures must not cause cross-company work or repeat a completed change. Cost limits and missing providers must be visible before starting paid/background work.

Acceptance requires executing this scenario with synthetic records across invoicing, communications, calendar, ticket review, Gate coverage, equipment and Hotlist, including a failed scheduling response, a retry, a revoked permission and a resumed plan. Existing specialist directory and individual tools do not establish that durable orchestration, unattended communication monitoring or a return trigger is implemented. Those remain explicit implementation and verification gaps.

1. Live verification of the new component-mediated action panel. The candidate binds authorization to the current connection and saved action, rechecks permissions at submission, and reuses durable results. Location-dependent actions still use the secure device authorization page.
2. End-to-end synthetic persona and company/site assignment checks for Gate, tickets, Work Hub and inventory. Base role descriptors alone do not prove gatekeeper, foreman or fleet-manager entitlement.
3. Live verification of the separately consented payment-record transition and evidence-upload workflows, with canonical finance permissions and actual result checks.
4. Meeting audio/video capture, transcription input, camera uploads and continuous location collection need a supported device integration. Existing meeting/transcript management tools do not themselves collect media.
5. Fleet package connection once its trusted vehicle/driver/load and GPS-tag services exist.

## Validation status

### Live readable action panel — 2026-10-07 01:20 UTC

Release `278bb9e706ab8bf3e4092cc2f05fe61e41622772` passed web and API deployment; public API health recovered to HTTP 200. An actual ChatGPT action panel rendered a description-only readable summary for new fictional task creation using Synthetic OpenAI Reviewer. Action `1069.w5GfINuvZEwJ3dayQdBEdnbSHSyYPir5-Mij9tuqw-Q` was submitted through the embedded approval control and displayed “The change completed.” Canonical cookie-authenticated GET /work-hub/tasks independently returned exactly one matching task, `c33e5e14-d6e8-452a-a6d9-48a6277fcdcf`, version 1, open, with the exact fictional title and description and no due date. The existing coordinated plan task remained version 6 with its serialized description preserved. Evidence: `V-Connection-Runtime/synthetic-readable-action-readback.json` and local screenshot `chatgpt-readable-action-completed.jpg`. This proves the deployed readable panel and one canonical task creation, not full domain parity, notification delivery or unattended orchestration.

The ticket device retry in a fresh tab rendered the authenticated synthetic partner navigation and onboarding stepper but no ticket content. No browser console errors were returned. Reloading that ticket tab again stalled browser observation; the underlying rendering cause remains unresolved. This is not evidence of successful photo entry or a repaired ticket handoff.

At 01:27 UTC, the same fictional task completed through action `1069.PvOO6JX3HBdSZotzDuQp2Y63719ZjOKUNUuftD7Ko3Y`, operation `9f1182d7-26dc-40fb-8ca0-af3072899c20`, applied at 01:26:53.175Z with replayed=false. Canonical independent readback confirms completed status, version 2, unchanged title/description, no assignee and no due date. The coordinated plan remains version 6. This establishes ChatGPT task creation and completion, not delivery or background execution. The completion summary initially omitted taskId outside expanded details; a local follow-up adds task/calendar/asset/station/trip identifiers to the summary and passes nine panel checks, but is not yet deployed.

### Live Gate role boundary — 2026-10-07 00:19 UTC

Production web and API deployment of `301bf03d745c57c0342e746a54d7e582adf68b62` passed, with public health returning 200 after restart. The fictional relationship for Vendor 1107 and Partner 609 was restored through the canonical approval endpoint without changing its existing fictional agreement. Canonical role updates tested worker 1073/person 969 as both gatekeeper and gate supervisor: each returned exactly Site 392 and HTTP 200 from the Gate review queue. Original gatekeeper access was restored and reread. Only fictional records were changed; passwords were unchanged. Evidence: `V-Connection-Runtime/synthetic-gate-role-boundaries-postdeploy.json`. This proves live API site/read boundaries, not an actual ChatGPT worker account connection or complete check-in/out workflow. Later access-migration replay and planned-read checkpoint candidates remain in validation.

Candidate API typecheck and focused authorization, workspace, runtime and connection tests pass locally. Full repository validation, deployment and live ChatGPT verification remain required before calling this expansion released. No live records were changed by these local tests.
### Ticket crew acknowledgement

`acknowledge_ticket_assignment` confirms or declines the connected user's own active crew assignment through the canonical endpoint. Both the worker record and ticket must belong to the current vendor context. Other-worker identifiers are ignored, removed assignments are refused, and vendor contract acceptance remains a separate action. The isolated database regression covers these boundaries; complete workflow parity still requires the remaining device and domain capabilities documented below.

### Ticket corrections follow-up

The follow-up adds platform-administrator-only `manage_ticket_record` action `unlock` for submitted/approved corrections, requiring a trimmed reason of 1 to 500 characters. It cannot substitute for cancelled-ticket reactivation or change the requested target status. `reverse_ticket_payment_record` uses the canonical AP reversal endpoint and the separately consented `finance:write` family. It restores the accounting record to `approved` and retains domain audit history; it never refunds or cancels a real payment. Both adapters forward only the exact ticket and reason, require saved-action authorization, and leave current status and Accounts Payable checks to the canonical endpoint. Focused adapter/scope tests pass; this follow-up still requires full validation and deployment.


## Asset recovery expansion requirement (not implemented)

Inventory/Fleet should support authorized lost/stolen reports, original ownership evidence, exact normalized VIN/serial/manufacturer identifiers, and a recovery case with disputed, resolved and withdrawn states. Asset names alone must never trigger a theft match. Reporting an item stolen is an allegation, not proof of ownership or wrongdoing.

A registration matching an active stolen report should retain the attempted registration as pending verification, preserve existing ownership and custody, and privately notify authorized recovery staff and the reporting owner. Do not falsely confirm ownership or disclose another company's records. Allow mediated contact and release direct contact details only under an authorized disclosure rule. Preserve evidence, match confidence, notification acknowledgements and an audit trail; support false-positive appeals and legitimate transfers.

Tracker providers must use an extensible adapter with explicit account authorization, asset binding, last observation time, source and accuracy. Show location, distance or routing only from verified authorized observations, clearly labeling stale or unavailable data. Apple Find My sharing is not evidence that VNDRLY has a supported location API. Concealed installation on owned equipment does not guarantee concealment from a finder: AirTag and compatible devices provide unwanted-tracking alerts. Do not disable those protections. Fleet cellular/GPS providers require a separate verified integration and cost assessment.

Acceptance: synthetic exact match across two isolated companies creates one private recovery case on retry, never transfers ownership, never leaks the owner's identity to an unverified registrant, refuses unauthorized location access, and handles a withdrawn report and a verified sale without a permanent theft flag. This requirement does not claim a deployed registry, tracker connection or recovery workflow.

### Coordinated plan controls candidate

`v_prepare_work_plan_control` prepares one step's waiting, pending (retry), or cancelled state through canonical Work Hub task updates and the existing authorization panel. It requires both task reads and writes, the linked plan user/company, and the exact fetched task version. It preserves the task's current status and refuses terminal steps/tasks. Retry checks currently permitted tools. It cannot manufacture completed checkpoints, run external work, cancel already-running provider actions, or start unattended monitoring. Canonical update readback and full deployment verification remain required.

#### Live persistence verification — 2026-10-07 00:06 UTC

The deployed payload correction passed an actual ChatGPT embedded-panel execution using only Synthetic OpenAI Reviewer. Action `1069.CQqwIkYfoHAZJ83OjjxKPn4VRvJ6h-6ITPkVZ-QBPl8` completed with operation `add98ef7-2eaf-4f07-83d0-073e039a87fd`. Independent `list_work_hub_tasks` readback confirms task `23598d53-27fd-4eb6-bf6b-4e32ec7f443a` version 5, embedded plan version 4, and `gate_coverage` state `waiting` with the exact synthetic persistence-check detail. Other steps retain their previous states. This proves the plan-step pause was saved; it does not prove background execution, calendar recovery or Gate coverage completion. The new scoped Gate access and staff-qualification fixes remain in separate validation candidates.

### Dictated safety drafts (candidate)
The ChatGPT safety read family can prepare dictated safety-report fields through the existing pure draft helper. Results explicitly state that no report was submitted, no form was populated, and site access has not been verified. Saving the report still uses the authorized safety workflow. This addition is pending full release validation and live ChatGPT verification.

### Ticket device entry (candidate)
`v_open_ticket_entry` reads the exact authorized ticket before creating an account-bound link to the existing photo, parts, labor, or mileage entry screen. Opening the signed link rechecks the account, active organization, session generation, current connection grant and ticket access. The destination is fixed to the saved ticket; arbitrary redirects are rejected. The device screen retains edit-role and lifecycle checks. Opening the link does not save entries, upload photos, grant camera access or start GPS tracking. Completion requires readback of actual saved ticket records. This closes a device navigation gap, not independent capture inside ChatGPT; full release validation and live device verification remain pending.

#### Live device-screen retry — 2026-10-07 01:07 UTC

The existing synthetic ticket photo-entry tab initially rendered the sign-in form. Direct form entry signed in as Synthetic OpenAI Reviewer (partner609); the dashboard identified that exact fictional organization. No password was changed. The same saved credentials also passed canonical API sign-in, and GET /tickets/100005 returned HTTP200 in512ms with funds_dispersed status. The browser sign-in instead returned to the dashboard, losing the requested ticket destination. Explicit navigation back to /tickets/100005?askvEntry=photo then timed out; a fresh binding to that same tab also timed out. This distinguishes a browser ticket-screen/handoff failure from a rejected account or unavailable ticket API. No photo was selected, uploaded or saved, and no location permission was granted. Ticket device-entry completion remains unverified; do not describe opening its signed link as completing evidence capture.
