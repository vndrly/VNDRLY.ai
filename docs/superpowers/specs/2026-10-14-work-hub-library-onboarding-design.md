# Work Hub library, bundles and employee onboarding

## User-approved intent
Build the company library, reusable bundles, group/individual assignments and new-hire onboarding described in the conversation. Administrators can manage multiple policies/forms/polls, revise content, archive old material and distribute selected items. Employees receive one To Complete checklist on first entry, next login or immediately while online. Preserve Work Hub branding, published versions and completion receipts. No external dependency, invented company policy, real employee invitation during tests, destructive database operation or credential change.

## Approach
Extend the existing form templates, immutable instance snapshots, campaign commands and durable notification queue. This is preferable to a separate forms database (duplicate permissions/history) or only adding buttons to campaign lists (cannot model reusable bundles and per-new-hire deadlines). Keep library content, distribution campaigns and employee obligations distinct while sharing existing storage and authorization.

## Work Hub presentation
Tasks & Forms gets a branded tab row: To Complete, Library, Bundles, Assignments. Employees default to To Complete; administrator-only tabs follow current company membership permissions. Reuse existing two-pixel branded cards, pill buttons, shared modal chrome, search and compact rows. iPad/web use list plus selected detail; phones open a focused detail pane. EN/ES labels load through the corrected translation runtime.

Library filters Policies, Forms, Polls and Archived, with title/search/version/state/updated time. Detail exposes Preview, Edit draft, Create revision, Duplicate, Assign and Archive according to state. Policies use actual text or a finalized company file and explicit acknowledgement. Forms get an editable field builder with text, long text, number, date, checkbox and choices; required fields and option validation are server authoritative. Poll editor retains selection limits, anonymity, changes and closing visibility. No employee opening a preview counts as a response.

Bundles show named packages such as New Hire or Driver Onboarding. The editor selects published items, displays pinned versions, default due periods and presentation/required settings. Administrators may save a draft without assignment, preview a bundle and review a named audience before assigning. A bundle can contain four policies and eight forms; a current poll may be added if still open. No fictional MidCon policy or picnic choices are automatically published.

Assignments show per-person and per-bundle progress, outstanding/overdue/excluded/cancelled counts, exact content versions and receipts. Anonymous poll answers remain aggregate-only. Named general-form answers remain reviewable/exportable by authorized owners. To Complete groups obligations by bundle and due date and opens the existing exact assigned form route. Notifications open that same authorized checklist or instance.

## Versioning and cleanup
Draft content is editable. Publishing pins an immutable version. Create revision creates a new draft in the same content series; old assignments and receipts keep their prior bytes/fields/version. Publishing a revision asks whether to assign it to chosen recipients again; it does not silently replace their old obligations. Bundle versions also pin content references; administrators explicitly upgrade a bundle to newer published revisions.

Archive removes content from active library and prevents new distribution without erasing responses. Existing outstanding assignments continue unless separately cancelled. Closing a poll ends voting. Cancelling selected outstanding assignments preserves audit/history and never marks them completed. Archived content referenced by an enabled onboarding bundle must be shown as an actionable configuration problem before further assignments. No hard-delete/reset path is introduced.

## Audience and assignment rules
Audience selectors support individuals, existing company groups/crews and all active company members. Resolve members server-side under current company authority and show deduplicated eligible/excluded counts in review. Cross-company group members, suspended users and stale/revoked memberships are excluded or rejected; copying a URL does not grant access. A group assignment snapshots its current recipients; future group members enter only through an explicitly enabled ongoing onboarding rule.

Assign a single item or bundle through one reviewed, versioned, idempotent operation. Same employee/content version is not assigned twice when bundles overlap or a retry repeats. Show existing completed/outstanding obligations separately. An administrator may explicitly require a new completion rather than silently treating an old one as missing. Immutable assignment metadata records content/bundle version, membership generation, audience snapshot, due date, presentation rule and cancellation history.

Policy/form deadlines for a new hire begin at that employee's assignment time (default policy 30 elapsed days), not the original company's campaign publication date. Reuse delivery campaigns for a new assignment cohort without modifying other recipients' deadlines. A poll retains its original absolute closing instant: a closed poll is omitted from a new-hire package with a visible reason; assigning a new employee never reopens or extends it. Existing anonymous-poll and deadline checks remain authoritative.

## Automatic new-hire onboarding
Administrators enable an onboarding bundle and explicitly review its target company/roles/groups, content versions, deadlines and presentation. Default scope is memberships created after activation, so enabling it does not surprise all existing employees. Apply to existing employees is a separate reviewed assignment.

Current company membership is the trigger, not an account display name. First authorized entry ensures due onboarding obligations exist synchronously before presenting the checklist; a bounded background scan also catches new memberships/restarts. Idempotency binds bundle version, membership ID and content version. Rejoining after removal is a new membership obligation subject to explicit bundle rules; completed history is retained. Missing policy content, archived dependencies or expired polls are reported honestly.

First entry opens the checklist after authentication. Next login records a pending presentation and shows it on the next authenticated session. Immediate adds it to the live To Complete list and queues eligible push. Assignment is durable regardless of notification permission or device availability. Queueing never claims delivery or completion.

Required before starting work is optional per selected policy/form, off by default. When enabled, shared server guards enforce outstanding current-company obligations at actual start-work/check-in boundaries across Field, Fleet and Gate, including assistant actions. Authentication, safety reporting, emergency communications, viewing instructions, completing forms and administrator remediation remain accessible. Client redirects alone are not enforcement. An explicit audited administrator exemption records who/why rather than manufacturing acknowledgement.

## Persistence and execution boundaries
Add guarded nullable metadata columns to existing form-template and instance tables; no new external service or destructive schema change. Library metadata stores record kind, content series/version, draft/published/archived state and timestamps. Bundle metadata stores pinned entry references and onboarding rule settings. Instance metadata stores bundle/assignment origin and per-person presentation/due/cancellation state. Exact names and migration details belong in the implementation plan. Existing ordinary templates/campaigns remain readable; legacy generic lists exclude bundle/internal records and private metadata.

Reuse signed-session/current-membership checks, command receipts, row locks, immutable submissions and notification dedupe. Serialize assignment/onboarding under bundle/content locks and deterministic operation identity. Recheck current authorization before replaying an old result. Account changes invalidate pending reads/writes and cached private views. Notification links use exact UUIDs and preserve login destination; delivery rechecks current recipient authority and preferences.

Daily owner briefings/reminders/escalation continue through existing campaign workers. Paused/archived rules stop future onboarding distribution; outstanding assignment treatment is separately visible. No transaction claims that a push was delivered. No sensitive policy snapshot locator or individual anonymous answer leaks through legacy lists, search, exports, assistant views or notifications.

## iOS, web and AskV parity
Implement the same library/bundle/assignment/onboarding contracts in native and web. AskV can list/review eligible content, prepare drafts/bundles, preview exact audience, assign after existing exact-value confirmation and read authorized progress. It may submit only the authenticated caller's explicitly confirmed response. It cannot acknowledge for a new hire, bypass required work guards or invent company policy. Embedded views show human-clickable library/bundle/checklist links and canonical receipts. Preserve installed plugin identity/accounts/grants; local candidate updates are not installed/public status.

## Verification and release evidence
Cover immutable revisions, archive-versus-cancel, per-new-hire deadlines, expired polls, group dedupe/tenant rejection, existing-response reuse, explicit renewal, first-entry/next-login/immediate presentation, online updates, duplicate login/worker restart, stale session, blocked work and exemptions, anonymous leaks and account-switch read races. Use injected clock and synthetic fixtures. Assert actual runtime translations and screen behavior in addition to locale parity.

The user already accepted the absent isolated PostgreSQL database as a testing blocker. Do not run reset wrappers against shared Supabase. Complete safe local tests/types/package checks and record unverified DB transaction/concurrency/e2e and real-device push evidence. No actual MidCon policy publication or employee notification occurs during implementation. Production migration/deployment, native release and installed plugin verification remain explicit release lanes; do not describe local previews as installed iOS functionality.

## Self-review
Intent, UI, persistence ownership, archive/cancel semantics, version preservation, audience authorization, assignment-specific deadlines, onboarding activation cutoff, optional work guards and notification limits are specified. No placeholder policy content, destructive operation, new dependency or fake delivery/receipt is proposed. This spec extends rather than replaces the approved form campaigns feature.
