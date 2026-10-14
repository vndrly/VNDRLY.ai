# Form campaigns: policy acknowledgements and timed polls

## Approved intent
Extend existing VNDRLY forms into company-scoped campaigns that administrators can publish to employees, monitor through deadlines, and receive progress briefings for. MidCon security acknowledgement has a 30-day horizon. Company picnic poll has a 24-hour horizon. Existing app permissions, immutable submission history, reliable notifications and AskV boundaries remain authoritative. No external dependency or destructive database operation.

## Configuration and defaults
All discussed options are available, not simultaneously compulsory.
- Kinds: policy acknowledgement, poll, general existing form.
- Audience: selected active company members or all active members. Default snapshots membership at publication; optional include new employees until the deadline.
- Acknowledgement: policy text or attachment, explicit policy version, required acknowledgement checkbox, named authenticated receipt. Default deadline 30 days after publication. Late acknowledgement remains possible and is marked late.
- Poll: question, labeled choices, single-choice default, optional multiple selections. Default closes 24 hours after publication. Optional allow changes before close. Named default; optional anonymous answers. Default reveal aggregate results at close; configurable live aggregate results. No votes accepted after closing, including delayed offline submissions. Show ties honestly rather than inventing a winner.
- Owner briefing: optional daily in-app briefing with progress counts and link, optional push. Default local company time 08:00, America/Chicago for MidCon. Scheduler stores UTC instants and explicit IANA timezone. Quiet-hour preferences are respected.
- Reminders: configurable cadence, nonresponders only, stop after response/close. Acknowledgements may continue overdue reminders under configuration. One deadline notification to owner.
- Escalation: optional named current supervisor/admin recipient, configurable overdue delay. Does not mark an item completed or automatically send to external parties.
- Employee removal/suspension blocks access immediately. Owner progress identifies excluded recipients separately; does not manufacture acknowledgements. New hires are added only under rolling audience mode.

## Screens and workflows
Create assignment adds campaign creation alongside simple task and existing form assignment. Campaign editor has kind, content, audience, duration/deadline, reminder and briefing settings; advanced settings are expandable. Review shows exact audience count, deadline/timezone and notification plan before Publish.

Tasks & Forms and My Work show assigned campaigns with due/closing time, state, and direct Open action. Notification deep links open the exact form instance after login with company checks. A policy opens its content and explicit acknowledgement. A poll opens choices and Submit vote, countdown and allowed results. Required fields, saved receipts, failed submissions and uncertain retries have visible states.

Owner view shows response totals, eligible audience, excluded recipients, overdue counts, deadline, settings and chronological briefings. Named acknowledgements provide employee/version/time receipts. Anonymous polls provide turnout and totals without exposing individual answers through owner UI, exports, assistant tools or result endpoints. Keeping eligibility separate from answers must not be represented as cryptographic anonymity.

Publish is an explicit action and the first point at which real recipients are notified. Draft saves and preview send nothing. Copy links do not grant access. Production recipients are never used for synthetic verification.

## Data and server contracts
Reuse form templates, versioned instance definition snapshots and immutable form submissions. Add campaign configuration/state as additive fields as needed; guarded migration never resets tables. Policy text/version is snapshotted into each assigned instance. Revising a published policy creates a new campaign/version and new acknowledgement obligation; old receipts remain intact.

Server derives recipients from current company memberships, never a model-generated company roster. Validate owner/admin eligibility, template owner, recipient eligibility and current signed session for every operation. Locks serialize publish, rolling-audience expansion, submission changes and close. Idempotent command keys bind actor, campaign, exact payload and version. Retries return original canonical receipts after current authorization is rechecked.

Responses enforce one current response per assigned employee, using existing submission version history when changes are permitted. Deadline check uses server time inside the same transaction as persistence. Acknowledgement must explicitly be true, not inferred from opening a page. Poll values must match configured choices and selection limits.

## Scheduled processing
Use the existing background-worker and durable notification mechanisms. Atomically claim scheduled work, use occurrence-specific dedupe keys, and persist next execution time/receipt. Recovery after restart must not duplicate audience assignments, reminders, daily briefs, final results or escalation. Recheck current policy, campaign state, recipients and notification preferences before delivery. Push failure preserves inbox and retry; queued does not mean delivered.

Daily brief is a stored progress snapshot with response/pending/overdue/excluded counts and deep link. Poll closes once and produces final aggregate results. Company-only scopes apply to briefings, exports and assistant reads. No external email/SMS provider is added.

## AskV/web/iOS parity
Shared APIs provide campaign discovery, assigned instance read/submission, authorized progress/results, draft creation and configured publish/manage actions. Existing confirmation, idempotency and audit rules govern assistant writes. Native and web render the same snapshotted form and canonical result. Installed plugin updates remain a later release lane; do not claim local changes installed or publicly available.

## MidCon draft
Create only an unpublished security-policy draft until the user supplies actual approved policy text or attachment. Do not invent MidCon policy, employee acknowledgements or a picnic decision. No bulk assignment or notification during implementation/testing.

## Verification and boundaries
Tests cover 30-day acknowledgement and 24-hour poll using an injected clock; exact closing boundary, late acknowledgement, vote edits, concurrent submissions, restart/retry dedupe, rolling membership, removal, named/anonymous result boundaries, unauthorized access, notification routes and brief schedules. Use synthetic recipients and an isolated database. User has stated there is no isolated PostgreSQL environment; safe tests continue and transaction integration remains an explicit blocker. Native push/device proof and production deployment are separate and unverified until performed.

The approved scope is implementation, not publishing MidCon content or sending actual invitations. No destructive DB operations, credential changes, new provider or App Store submission.
