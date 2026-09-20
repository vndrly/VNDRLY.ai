# Ask V Gate Natural-Language Submission and Full Toolbox Design

## Status

Approved in conversation on September 20, 2026, subject to review of this
written contract before implementation. This design intentionally supersedes
the manual-submit boundary in the September 18 Gate designs. Their location,
history, provenance, privacy, authorization, audit, and idempotency rules remain
in force.

## Goal

Make Ask V the fastest path through Gate. A gatekeeper should be able to speak
ordinary language such as "check Bob Villa in, same vehicle" or "Oklahoma plate
ABC123 is leaving" and have Ask V resolve the authorized record, populate the
same Gate form, and complete the requested check-in or check-out without a
capability lecture or an unnecessary questionnaire.

Ask V may submit only within the signed-in gatekeeper's existing authority and
only when the user's language authorizes that exact submission. Ask V receives
no elevated role and cannot bypass location, assignment, required-field,
authorization, audit, or duplicate-submit protections.

## Interaction Contract

1. **Tool first.** On a recognized Gate command, Ask V resolves and acts before
   speaking. It does not explain what it can do, narrate its plan, repeat policy,
   or read the form back field by field.
2. **Ordinary language.** Intent is semantic, not dependent on one exact phrase.
   Natural variants, names, companies, plates, states, relative references such
   as "same vehicle," and corrections are accepted.
3. **One question maximum.** Ask V asks one short question only when a material
   ambiguity or unresolved required value prevents safe execution.
4. **Optional means optional.** Missing optional purpose, notes, duration, or
   similar fields never causes an interview. Ask V leaves them blank or uses an
   authorized historical suggestion when the Gate form already supports it.
5. **Quiet success.** Preparation is silent. A completed mutation gets one short
   acknowledgment such as "Bob Villa checked in" or "Bob Villa checked out."
6. **Concise failure.** A failure response says only what the gatekeeper must do
   next. It does not produce a general explanation of Ask V limitations.

Typical spoken output should remain under ten words. The only longer response
is a minimum necessary ambiguity choice.

## Intent and Submission Rules

### Prepare-only intent

Language such as "new check-in for Bob," "pull up Bob's check-in," or "start a
Gate entry" prepares and displays a draft but does not submit it. After the form
is ready, Ask V asks once:

> Complete check-in or add details?

The gatekeeper may edit the form manually or answer in ordinary language.

### Submission intent in the original command

Imperative completion language such as "check Bob in," "check Bob out,"
"complete the check-in," "submit it," or an equivalent unambiguous command is
itself explicit confirmation for the exact resolved Gate action. Ask V may
execute the existing confirmed mutation immediately after resolution. It must
not ask for confirmation a second time.

The original user utterance is preserved as the confirmation phrase and bound
server-side to the exact action fingerprint, organization, Gate context,
resolved visitor or visit, site, and arguments. A model-generated
`confirmed:true` value without that bound user evidence remains invalid.

### Submission intent after preparation

When a draft is already pending, responses including "complete it," "submit,"
"go ahead," "check them in," "nothing else," or "no more details" authorize
the exact pending action. A bare "no" authorizes submission only when it is the
direct answer to Ask V's current, context-bound question asking whether to add
details before completion. It never acts as a free-standing global approval.

Changing a material field invalidates the old action fingerprint. The updated
form values must be rebound to the pending action before submission so a stale
voice turn cannot submit superseded details.

### Ambiguity, conflict, and cancellation

- If one authorized match exists, Ask V proceeds without discussion.
- If multiple material matches exist, Ask V asks one minimal choice question.
- An explicit current fact overrides a historical suggestion.
- "Stop," "cancel," "never mind," and equivalent language cancel the pending
  action and must not submit.
- If safe resolution is still impossible after one answer, Ask V leaves the
  draft open and states the one unresolved requirement.

## Natural-Language Understanding

The implementation uses a deterministic Gate intent layer around the model's
tool selection. It classifies:

- action: prepare check-in, submit check-in, prepare check-out, submit
  check-out, correct draft, cancel, history lookup, or other Gate function;
- entities: person, company, plate, plate state, local rig or well, time, and
  notes;
- references: same plate, same vehicle, last driver, this visitor, that visit,
  and the current pending draft;
- speech act: information, correction, confirmation, rejection, or command.

The product does not silently "learn" new executable phrases in production.
Instead, privacy-safe unmatched or corrected intent categories may be counted
for review. New language variants are added to a tested evaluation corpus and
released deliberately. This provides broad everyday-language support without
allowing an accidental phrase to widen mutation authority.

## Check-In Resolution and Backfill

1. Resolve the device GPS against the signed-in gatekeeper's assigned sites.
2. Keep the lease or location context GPS-determined and unchangeable.
3. Offer only rigs or wells at that resolved location. Suggest the last valid
   local rig, but allow the gatekeeper to change it.
4. Match history by normalized plate state and number when supplied.
5. For a unique authorized plate match, suggest the most recent submitted
   driver, company, purpose, expected duration, and still-valid local rig.
6. Treat the historical driver as editable because fleet vehicles may change
   drivers. An explicitly spoken driver always wins.
7. Keep the historically stable company unless the gatekeeper supplies a
   current correction or the authorized history is inconsistent.
8. Derive the host from the selected site's lease-holding energy partner.
   Host remains absent from the Gate form and Ask V dialogue.
9. Only a submitted visit becomes future history. A prepared or cancelled
   draft never changes the next backfill.

Every inferred field retains provenance for audit and troubleshooting without
requiring Ask V to recite it during routine work.

## Check-Out Resolution

Ask V resolves active visits by spoken person, company, plate, or current Gate
context. One exact match is selected silently. The imperative "check X out" or
equivalent submits the bound check-out immediately. A prepare-only request opens
the draft and uses the same single-question interaction contract. Multiple
matches produce one concise choice.

## Complete Gate Toolbox

Ask V must have a permission-scoped contract for every functional Gate action
available to the signed-in user:

- resolve current authorized Gate location from device GPS;
- list valid rigs or wells at that location;
- read a plate through the existing OCR or vehicle-photo path;
- normalize and search plate state and number;
- search authorized Gate history by person, company, plate, date, recorder, or
  active status;
- list visitors currently on site;
- resolve and prefill a check-in candidate with field provenance;
- prepare, correct, cancel, and submit a visitor check-in;
- resolve active visits and prepare, correct, cancel, and submit check-out;
- add or update checkout notes when permitted;
- answer recorded-attendant and authoritative shift-context questions;
- report validation, permission, location, duplicate, stale-action, and network
  failures concisely;
- open or focus the corresponding Gate surface when presentation is required.

A checked-in Gate page-to-tool manifest maps each visible action to its tool,
role or capability, confirmation class, audit target, web availability, iOS
availability, and focused contract test. The build fails if a functional Gate
action lacks Ask V coverage or web and iOS resolve different authority.

## Server Execution Boundary

`confirm_visitor_check_in` and `confirm_visitor_check_out` remain the sole Ask V
mutation tools. They are added to the Gate screen tool pack for authorized Gate
roles, but stay marked mutating, high-risk, confirmation-required, audited, and
idempotent in the registry.

The existing pending-confirmation store remains authoritative. The new Gate
intent layer may satisfy confirmation from the original imperative command or
from the later context-bound reply, but cannot bypass the store. Execution must
revalidate:

- authenticated user and active organization;
- Gate role and assigned-site access;
- device location and selected local rig where required;
- visitor or active-visit identity;
- required fields and current action fingerprint;
- duplicate or already-completed state;
- idempotency key and audit metadata.

Retries, reconnects, repeated voice turns, and web/iOS handoff return the prior
result rather than creating a duplicate visit.

## Web and iOS Parity

Web and iOS share the same server-defined tool metadata, intent semantics,
confirmation evidence, location rules, resolver, history scope, and response
budget. Both clients:

- attach trusted device GPS and never accept model-invented coordinates;
- apply resolved drafts to the visible Gate form;
- keep manual editing available before a prepare-only submission;
- submit immediately for a safe imperative command;
- suppress redundant model responses while a tool is executing;
- show and speak the same concise success or recovery result;
- preserve plate OCR and manual entry as equal alternatives.

Client code may render or focus controls, but it may not independently decide
authorization or manufacture confirmation.

## Observability and Sales-Pitch Protection

Add privacy-safe Gate voice metrics for:

- command-to-draft and command-to-completed-visit latency;
- number of Ask V questions per Gate action;
- intent class and completion outcome;
- ambiguity, permission, stale-action, duplicate, and network failures;
- user correction after historical backfill;
- abandoned prepared actions;
- excessive-response and repeated-command regressions.

Raw audio is not stored for this purpose. Tests enforce zero capability essays,
one-question maximum, quiet preparation, and concise success acknowledgments.

## Verification

### Language and behavior contracts

- common variants of check in, check out, submit, complete, go ahead, add
  details, no more details, cancel, same vehicle, and correction language map
  to the intended action;
- prepare-only phrases never submit;
- explicit imperative commands submit without a second confirmation;
- a context-bound response submits only the exact pending action;
- model-supplied confirmation without user evidence is rejected;
- changed material fields invalidate stale confirmation;
- optional missing fields do not trigger questions;
- ambiguity produces at most one minimal question;
- preparation is silent and success uses one short acknowledgment;
- cancellation never mutates data.

### Gate data and safety contracts

- plate history backfills the latest submitted driver and stable company;
- explicit driver or company corrections win;
- shared fleet vehicles remain editable;
- state collisions and same-name collisions are not guessed;
- GPS locks the location and only local rigs populate the selector;
- host is derived server-side and absent from the workflow;
- unauthorized sites and unrelated organizations disclose nothing;
- duplicate and replayed commands create exactly one visit;
- audit records distinguish supplied, inferred, corrected, confirmed, and
  submitted values.

### Toolbox and parity contracts

- every Gate page function has a page-to-tool manifest entry and focused test;
- every mutation retains permission, confirmation, idempotency, and audit
  metadata;
- web and iOS expose the same authorized Gate functionality;
- OCR, manual, typed, and spoken paths converge on the same resolver and
  mutation endpoints;
- typed and voice Ask V use the same pending-action rules.

### Release gates

- focused Ask V, realtime, Gate, history, confirmation, web, and mobile tests;
- locale parity, typecheck, web suite, API suite, mobile suite, and end-to-end
  coverage;
- production web, API, and mobile builds;
- additive guarded migration verification only if an index or audit field is
  required;
- full ship through non-force main advancement, public web verification, API
  health and safe Supabase changes if any, production iOS OTA, and TestFlight
  build submission.

No destructive database change, privilege widening, force push, or public App
Store release is authorized by this design.
