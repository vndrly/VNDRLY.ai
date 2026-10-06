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

1. Live verification of the new component-mediated action panel. The candidate binds authorization to the current connection and saved action, rechecks permissions at submission, and reuses durable results. Location-dependent actions still use the secure device authorization page.
2. End-to-end synthetic persona and company/site assignment checks for Gate, tickets, Work Hub and inventory. Base role descriptors alone do not prove gatekeeper, foreman or fleet-manager entitlement.
3. Live verification of the separately consented payment-record transition and evidence-upload workflows, with canonical finance permissions and actual result checks.
4. Meeting audio/video capture, transcription input, camera uploads and continuous location collection need a supported device integration. Existing meeting/transcript management tools do not themselves collect media.
5. Fleet package connection once its trusted vehicle/driver/load and GPS-tag services exist.

## Validation status

Candidate API typecheck and focused authorization, workspace, runtime and connection tests pass locally. Full repository validation, deployment and live ChatGPT verification remain required before calling this expansion released. No live records were changed by these local tests.
### Ticket crew acknowledgement

`acknowledge_ticket_assignment` confirms or declines the connected user's own active crew assignment through the canonical endpoint. Both the worker record and ticket must belong to the current vendor context. Other-worker identifiers are ignored, removed assignments are refused, and vendor contract acceptance remains a separate action. The isolated database regression covers these boundaries; complete workflow parity still requires the remaining device and domain capabilities documented below.

### Ticket corrections follow-up

The follow-up adds platform-administrator-only `manage_ticket_record` action `unlock` for submitted/approved corrections, requiring a trimmed reason of 1 to 500 characters. It cannot substitute for cancelled-ticket reactivation or change the requested target status. `reverse_ticket_payment_record` uses the canonical AP reversal endpoint and the separately consented `finance:write` family. It restores the accounting record to `approved` and retains domain audit history; it never refunds or cancels a real payment. Both adapters forward only the exact ticket and reason, require saved-action authorization, and leave current status and Accounts Payable checks to the canonical endpoint. Focused adapter/scope tests pass; this follow-up still requires full validation and deployment.

