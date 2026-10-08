# VNDRLY native capabilities and unified V implementation plan

Interview completed: October 7, 2026. Design only; no application code, accounts, signing credentials, or deployments changed by this interview. All 50 answers are recorded below. This document is ready to return to the original integration task; it has not been sent to another chat.

## Outcome and release policy

Build native operational capabilities that save canonical VNDRLY records and can be requested or inspected through iOS, web, AskV, and the ChatGPT VNDRLY plugin. Present one assistant, V, coordinating the existing AskV engine and OpenAI models selectively. Apple on-device AI remains an optional reviewed-draft producer, not the VNDRLY tool executor or replacement for AskV/ChatGPT.

Release the complete verified scope to all companies with features enabled by default and company opt-out controls. No customer pilot or company activation requirement. Enabled-by-default does not activate modules a company does not use, expand user permissions, link external accounts, grant Apple permissions, consent to worker tracking, or select automatic arrival for workers. Internal implementation milestones and device verification are not customer rollout phases; incomplete milestones do not constitute final delivery.

Status baseline: the supplied design describes a reviewed implementation candidate, not a proven native deployment. The supplied signing-readiness snapshot names candidate 8a7de7472efe9150bfe270679b700214f58d6b73 and a missing provisioning record for com.vndrly.field.workactivity. Treat these as historical input to recheck in the original release task, not current verified release status. Actual archive, signing, submission, and physical-device proof must be obtained.

## Decision log

| # | Confirmed decision |
|---|---|
| 1 | Offline location requests immediately report unavailable; photo requests queue visibly with expiry. |
| 2 | Photo expiry is shift end or eight hours after request, whichever is earlier. |
| 3 | Company supervisors and designated partner/site supervisors may request; worker company explicitly grants partner/site access. |
| 4 | Worker saves location consent once for future active-duty shifts and may turn it off visibly. |
| 5 | Support manual, ticket-driven, and scheduled duty; vendor configures fleet/field/gate business workflows. |
| 6 | Worker End Duty immediately ends duty and location responses; supervisor receives override notice. |
| 7 | Supervisors see location unavailable and that the worker turned sharing off; show duty status separately. |
| 8 | Location-request history records requester, time, and result quietly in-app. |
| 9 | One fresh-location request per worker every five minutes across requesters; show previous result and age. |
| 10 | Unsuccessful fresh request may show explicitly labeled last-known position, capture time, and accuracy. |
| 11 | Photo request sends actionable notification opening exact ticket/request; camera, review, and save remain explicit worker steps. |
| 12 | New camera photo is default; requester may allow existing photo, with source and capture time when available. |
| 13 | Decline requires unsafe now, inaccessible subject, wrong ticket, or other reason; notify requester. |
| 14 | Expired unanswered photo request notifies requester only; requester decides whether to repeat it. |
| 15 | Live Activity follows current role task: field ticket, fleet run, or gate shift. |
| 16 | Lock Screen shows company, site, ticket/run identifier, status, elapsed time, last update, and ETA when available. |
| 17 | Worker chooses primary task; retain until ended or switched. |
| 18 | First system actions: My Workday, current task, scan, start/end duty. |
| 19 | Siri start-duty requires confirmation; end-duty acts immediately; both authenticate and report saved result. |
| 20 | Notifications support acknowledge, assignment accept/decline, and reply; complex changes and photos open exact app task. |
| 21 | Off-duty assignments arrive quietly with no response expected until next shift; separately agreed on-call schedule can differ. |
| 22 | First scanning scope includes tickets, inventory, and gate documents, with separate access and retention. |
| 23 | Retain reviewed gate ID fields and image; restrict image to authorized gate staff. |
| 24 | Delete ID image thirty days after visit; retain permitted visit record. |
| 25 | Highlight uncertain extracted fields and require confirmation/correction against source before save. |
| 26 | Offline assignments, ticket drafts, photos/scans, inventory changes, and gate check-in/out; show pending synchronization. |
| 27 | Offline gate can record entry with authorization-not-verified warning; flag for review after synchronization. |
| 28 | Preserve both conflicting inventory transactions and flag for authorized reconciliation. |
| 29 | Upload over cellular/Wi-Fi immediately; worker may pause or choose Wi-Fi only; saved record defines completion. |
| 30 | Draft ticket notes, shift handoffs, incidents, inventory/gate summaries, fleet reports; templates and data follow company modules and roles. |
| 31 | When local AI unavailable, manual draft or explicit cloud AskV switch with selected-content disclosure. |
| 32 | Shared authorized workflows on iOS/web/AskV/ChatGPT; device-specific work hands off to designated phone. |
| 33 | Handoff produces notification and My Workday pending item linked to exact record and saved draft. |
| 34 | Switching phones moves pending requests; old-phone started uploads finish original records; only new phone supplies requested location. |
| 35 | Add navigation/arrival assistance and voice-dictated reviewed task drafts. |
| 36 | Default arrival confirmation; automatic arrival when vendor enables and worker opts in; visible correction. |
| 37 | Worker may attach original dictation audio to the authorized record alongside reviewed text. |
| 38 | Company escalation: assigned duty contact, then backup after interval, respecting off-duty/on-call settings. |
| 39 | Separate delivery from acknowledgment; escalate unacknowledged alerts; notification-readiness check. No SMS/Critical Alerts scope selected. |
| 40 | One V, selective cooperation: shared conversation/task context, suitable engine first, second consulted when needed. |
| 41 | Company-approved and worker-linked personal connections, separated and explicitly selected per task; preserve tasks missing connection. |
| 42 | Share minimum task-authorized context with approved providers; worker permission for personal-connection content. |
| 43 | Incomplete task shows succeeded/remaining/needed work and resumes without repeating completed actions. |
| 44 | VoiceOver, large text, contrast, large touch targets, and visual alternatives to audio. |
| 45 | Reduce background activity under low battery/poor network; degraded status, pending preservation, freshness, resumable uploads. |
| 46 | Support defaults to technical status; work-content access requires separate audited grant. |
| 47 | Device-request history one year; diagnostics ninety days; attachments follow record retention; ID image thirty days. |
| 48 | All companies, all verified features enabled by default, company opt-out; no pilot or company opt-in. |
| 49 | Company usage/cost alerts without hard spend cap; tasks continue. |
| 50 | Native/signing/device and cross-surface end-to-end evidence, offline recovery, canonical readback; clear unsupported-device/OS fallbacks. |

Established before question 1: fresh location may respond automatically only during opted-in active duty; off-duty unavailable. Worker selects a switchable work phone; other devices are viewers. Photo requires explicit camera opening, review, and save to exact requested ticket; requester receives canonical saved result.

## Capability and surface matrix

Every cell is constrained by enabled company modules, current role/membership, site, exact subject, and provider/connection policy. A surfaced action is not a grant of access.

| Capability | Native iOS | Web | AskV / unified V | ChatGPT VNDRLY plugin | Canonical outcome |
|---|---|---|---|---|---|
| Live Activities | Selected task projection on Lock Screen/Dynamic Island | Same task/freshness in dashboard | Read task; hand off task selection | Authorized task read/handoff | Existing task and duty record; activity itself is projection |
| Siri/Shortcuts/Action Button/controls | Authenticated intents and route handoff | Same underlying actions | Same action contract | Matching scoped tools where useful | Saved duty transition or authenticated navigation |
| Notifications | Acknowledge/assignment/reply; exact-record opening | Request and alert inbox | Create/read permitted requests and results | Same scoped request/result tools | Command acknowledgment, assignment state, message |
| Fresh location | Designated phone; duty/consent checks | Supervisor request and timestamped result | Request/read with scoped identity | Same authorized request/read | Immutable observation with capture time, accuracy, source |
| Requested photo | Explicit capture/review/upload/save | Request/status/saved media | Request and read result | Same request/status/result | Attachment ID on exact ticket |
| Scan/OCR | Private draft; confidence review; save | Review authorized result; own upload paths | Help interpret selected material | Authorized saved-result read/draft tools | Reviewed fields, source/provenance, attachment where permitted |
| Background upload | Persisted file-backed transfer and reconciliation | Pending/saved status | Read progress/result; resume handoff | Same permitted status/result | API-finalized attachment |
| Local AI drafts | Availability-gated reviewed draft | Saved draft/record via permissions | Cloud AskV explicit fallback; V retains toolbox | Access explicitly shared drafts/results | Human-reviewed domain record |
| Offline operations | Local journal/cache; explicit pending states | Reconciliation and gate/inventory review | Never claim unsynced change saved | Same canonical truth | Idempotent domain events and resolution history |
| Navigation/arrival | Maps route; confirmed or consented automatic arrival | ETA/arrival status | Route handoff and saved arrival read | Handoff/read | Domain arrival, preserving ticket lifecycle rules |
| Dictation/audio | Explicit recording, reviewed text, optional audio | Authorized text/media | Voice request to V; same confirmations | Compatible handoff/content tools | Reviewed note and optional attachment |
| Cooperative V | One task/conversation interface | Same V continuity | Selective model routing | VNDRLY tools plus explicit resumable handoff | One action ledger and saved domain results |
| External connections | Explicit company/personal connection selection | Connection policy/status | Use only granted connection scopes | Only available authorized ChatGPT/API integrations | Linked task/action result and provenance |

## Architecture boundaries and proposed implementation

1. Extend the existing Expo native-module/config-plugin pattern for ActivityKit/WidgetKit, App Intents, Vision/VisionKit, background URLSession, Speech, and local Foundation Models. Reuse existing domain API, authentication, push, uploads, localization, and router. Do not add a dependency or upgrade Expo merely for convenience. Unified V and expanded offline execution are major architecture extensions: review contracts and dependency choices before implementation under repository preferences.
2. Introduce a shared capability/action catalog keyed by company module, role, supported surface, device capability, and required consent. It drives visibility, templates, tool schemas, native intents, and API authorization rather than separate hard-coded rules per surface.
3. Server remains authority for duty, designated device binding/version, partner-site grants, commands, request expiry, attachment finalization, and audit. Check permissions at request creation, dispatch, execution, and save/readback. Never trust model-provided company IDs or confirmation claims.
4. Device requests bind immutable request ID, requester, worker, exact subject, purpose, designated-device version, creation/expiry times, and deduplication key. Suggested states: pending, delivered, opened, awaiting-worker, upload-in-progress, saved, declined, expired, unavailable, cancelled. Delivery/open/upload are not saved completion. Define allowed transitions per request type; location never queues for future reconnection.
5. Keep current effective-duty server record and vendor duty policy separate from worker saved consent. End Duty override suppresses automatic restart in that same duty period until explicit worker restart or the next valid duty period; this is a proposed rule requiring final contract confirmation. Enforce module/site/role and company opt-out before routing. Reject late location results after duty ends or consent is revoked; old phone binding cannot report worker location.
6. Photo expiry prevents new capture/submission after deadline; original uploads begun while valid need an explicit late-finalization rule. Proposed: finish transfer but recheck permissions, retain attempt, and distinguish late saved evidence from fulfilled-on-time request; do not silently satisfy an expired request. Confirm this rule before execution.
7. Offline journal stores encrypted task-bound drafts/events and required authorization snapshot metadata. Cache only authorized assigned work. Reconnect rechecks current permissions, deduplicates events, preserves capture/event time separately from server acceptance, and resolves conflicts explicitly. Offline gate authorization remains unverified until adjudicated; revoked access quarantines pending material for authorized resolution instead of publishing it. Offline End Duty stops local collection immediately; until server learns of it, no response may assert fresh location without a device duty check.
8. Preserve both inventory operations as immutable events; present the disputed balance/reconciliation status and never silently overwrite one worker. Gate events remain operational records of what staff reported, not assertions that authorization was verified. Reconcile duplicate entries, check-out ordering, and shared-device actor identity.
9. Background uploads use file-backed native sessions, persisted task IDs, scoped HTTPS signed URLs, original record binding, and API finalize/readback. Refresh expired upload grants through authenticated API; keep credentials in protected storage. Switching phones permits already-started uploads from old phone only, not new commands; revocation still blocks finalization. Reconcile server success after network interruption before retry.
10. V coordinator owns conversation/task state, bounded model consultation, selected connection, authorized context package, and durable step ledger. Both model engines receive the same allowed tool contracts; one coordinator serializes mutations, attaches idempotency keys, applies existing confirmations, and checks saved results. Permission denial is not a reason to try another engine to bypass policy. Retry transport ambiguity only after checking whether the action already succeeded. No autonomous model-to-model loop without bounded attempts/time/token budgets; these are per-task reliability limits, not company spending caps.
11. Do not imply in-app OpenAI use inherits a person's ChatGPT chat, subscription, connected apps, or grants. Company/personal connections require supported explicit authorization. Cross-surface continuation uses VNDRLY task IDs and deliberately shared context, not automatic access to private ChatGPT histories. Separate personal credentials/content from company stores; saving personal content to a company record requires explicit intent and applicable rights.
12. Local Foundation Models receives only worker-selected material and produces reviewed drafts. Force the selected model configuration to remain on-device; no silent Private Cloud Compute or third-party routing. No native model invokes VNDRLY mutations. Dictation is independent of AI draft generation; any cloud speech fallback needs explicit disclosure/consent if local recognition unavailable.

## Platform feasibility and permissions

Apple checks below were reviewed October 7, 2026. Exact deployment targets and installed SDK availability must be read from the release tree and validated in Xcode/EAS.

- Live Activities are bounded: Apple documents eight active hours, with up to four more on Lock Screen. Long shifts need a tested continuation/restart strategy and clear ended/stale state. Do not promise one uninterrupted all-shift activity. [ActivityKit](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)
- Silent pushes are not guaranteed and may be throttled; a five-minute request limit is not a guaranteed five-minute background service. Require execution deadlines and unavailable outcomes, rather than claiming remote GPS always wakes the phone. [Background notifications](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)
- Background location requires appropriate authorization/background configuration and actual lifecycle testing. Request only justified access; active-duty consent remains separate from OS permission. [Core Location authorization](https://developer.apple.com/documentation/corelocation/requesting-authorization-to-use-location-services)
- Background URLSession supports file-backed uploads across suspension, but force-quit does not guarantee relaunch. Restore and reconcile on app reopening; no false completion. [Background sessions](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/background(withIdentifier:)), [file-backed transfers](https://developer.apple.com/documentation/foundation/downloading-files-in-the-background)
- App Intents support system controls and shortcuts; configure authentication and device/OS checks. User places/configures controls; release cannot force assignment of their Action Button. [System surfaces](https://developer.apple.com/documentation/appintents/widgets-live-activities-and-controls), [authentication](https://developer.apple.com/documentation/AppIntents/AppIntent)
- VisionKit needs camera permission and runtime availability checks; unsupported scanning offers document/photo upload and manual fields. [VisionKit](https://developer.apple.com/documentation/visionkit/scanning-data-with-the-camera)
- Foundation Models availability varies with device, region, model readiness, and user settings. Use selected on-device model checks, manual drafting, or disclosed AskV fallback. [Availability](https://developer.apple.com/documentation/FoundationModels/generating-content-and-performing-tasks-with-foundation-models)
- Local speech recognition is capability-dependent; check support before requiring local execution. Microphone and applicable speech authorization are requested for explicit worker use. [Speech](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition)

Required configuration checklist: camera/microphone/location/speech purpose strings as applicable; notification authorization/categories and APNs environment; justified location/remote-notification background modes; Live Activity support and WidgetKit extension target; App Intents registration/authentication; App Groups only when needed with sanitized projections and matching target grants; protected keychain storage; file protection for offline data. Photo-library selection should use system picker rather than broad library access when sufficient. No always-on camera/microphone, off-duty tracking, Critical Alerts entitlement, or SMS provider is in scope.

Signing dependency from supplied snapshot: register/provision com.vndrly.field.workactivity within existing team and associate correct App Store profile with EAS; reuse valid distribution certificate and main-app profile. Recheck current credentials before acting; do not rotate/delete them or disable the extension to bypass signing. Archive must prove extension inclusion, matching entitlements, bundle identifiers, and correct distribution provisioning. Simulator/typescript checks alone do not prove device behavior.

## Retention, privacy, and support

- Request history: one year. Diagnostic logs: ninety days. Capture only necessary technical metadata; redact tokens, document text, personal connection payloads, and ID images from diagnostics.
- Gate ID images: delete thirty days after visit from active storage, generated previews, extraction copies, and caches; disable further read access at deadline. Define visit closure for multi-day/reopened visits and disclose backup purge schedule before implementation. Retained ID fields need a separate minimization/retention decision.
- Ticket/media/audio: domain record retention; original audio is saved only when worker chooses it. Unsaved audio is removed after transcription/draft lifecycle. Local OCR sources remain private until reviewed save; saved source follows permitted attachment policy, with ID exception.
- Local pending drafts/cache: protect at rest; invalidate view/access on logout, organization switch, revocation. Establish pending-draft expiry and recovery semantics before launch. Do not send unapproved local/private material to another provider.
- Support console shows version, permissions, device binding, connectivity, request state, sanitized failures, sync/upload status. Work-content access requires separate time-bounded audited grant with named purpose; default technical access cannot view ID media or personal connections.
- Cost monitoring: company spend/usage dashboard, configurable alert recipients/thresholds, engine consultations and retries visible in technical audit. No company hard spending cap. Show estimated versus billed cost distinctly; include storage, AI, transcription, compute, connection-provider costs. No invented fixed price; estimate after measured workloads and contracts.

## Internal milestones and completion evidence

| Milestone | Deliverables | Exit evidence |
|---|---|---|
| 0: Contracts and readiness | Exact release-tree inventory, existing APIs/native candidate review, proposed data contracts, policy catalog, signing/SDK/provider readiness | Gap list, confirmed unresolved semantics, dependency review; no shipped claims |
| 1: Authority and durable work | Duty/consent/device routing, supervisor grants, request lifecycle, offline journal/reconciliation, retention/audit | Cross-company/role tests; revocation/expiry/device-switch races; no duplicate domain writes |
| 2: Six native additions | Live Activities, intents/controls, notification actions, scan/OCR, background uploads, on-device drafts | Signed native archive including extension; physical-device execution; manual/fallback flows |
| 3: Operational expansion | Navigation/arrival, dictation/audio, offline gate/inventory, escalation and support | Conflict/outage/low-power/device-switch proofs; privacy/retention and accessibility checks |
| 4: One V and surface parity | Selective AskV/OpenAI coordination, resumable ledger, company/personal connections, web/plugin tools and views | Cross-engine recovery; one canonical action; scoped cross-surface readback; connection isolation |
| 5: Complete release | All verified capabilities enabled for all applicable companies; company opt-out; documentation/support readiness | Required repository gates, all release tracks, device evidence and exact release handoff |

Follow the repository's standing full-ship process when explicitly executing the implementation release: commit, non-force main advance, web/API plus guarded additive migrations/storage provisioning when needed, OTA compatibility handling, native TestFlight build/submit, and update existing ChatGPT plugin preserving grants. No duplicate plugin entries. Distinguish installed, submitted, approved, and public availability. This design interview does not authorize or perform the release itself.

Required acceptance scenarios:

1. Supervisor request through web/V/ChatGPT targets exact worker/site/company; unauthorized cross-company/role/module attempts fail. Partner/site access works only with worker-company grant.
2. Offline location immediately unavailable; fresh failure shows old observation explicitly. Five-minute limit applies across requesters. Off-duty/consent-revoked/old-device results cannot masquerade as fresh.
3. Photo queue expires correctly at duty/shift boundary or eight hours. Camera is explicit; review/save exact ticket. Decline reasons, existing-photo allowance, expired request, upload retry, and canonical requester readback all verified.
4. Every duty mode works. End Duty overrides automated policy immediately; notification and quiet history match decisions. Background OS limitations are visible and truthful.
5. Live Activity selected task, rich details, freshness, logout/context end, long-shift bounds, unsupported device fallback, and lock/unlock behavior verified physically.
6. Intents and notification actions authenticate, confirm as specified, bind exact record, prevent replay, and report canonical outcome. Quiet off-duty delivery respects supported system behavior and never promises Focus bypass.
7. OCR uncertainty is reviewed. Gate ID source and fields correctly restricted; thirty-day image removal verified including derivative access. Inventory duplicate/conflict and offline gate warning/review remain explicit.
8. Upload under suspension, process interruption, force-quit/reopen, URL expiry, lost response, low battery/network, company switch, revocation, and work-phone switch saves once or clearly remains pending/failed.
9. On-device model unsupported/disabled/unready remains usable manually; cloud fallback requires disclosure. Draft is never an automatic tool write. Dictation audio attaches only by worker choice.
10. Navigation confirmation and opted-in automatic arrival preserve coherent status/lifecycle and correction audit. No inferred location from viewer tablets.
11. V fails over selectively without repeating actions or bypassing denial. Both model engines use same company/site permissions. Missing connections produce resumable task; personal/company connections stay isolated.
12. Escalation separates push acceptance, observed delivery where available, opening, acknowledgment, and action completion. Do not fabricate device delivery receipt. VoiceOver/large text/contrast/targets/visual alerts verified.
13. Exact-tree required gates pass, native archive/signing/device proof retained, public web/API health verified, OTA group compatibility documented, TestFlight submission confirmed, installed plugin actual scoped read and synthetic harmless action verified with saved-result readback. Unsupported behavior is documented with a working fallback, not dropped from scope.

## Open items to resolve during contract review

These are explicit unresolved items, not presumed interview approval. No repeated broad interview is needed; bundle choices when execution reaches them.

- Duty precedence when multiple manual/ticket/schedule sources overlap; automatic restart suppression after End Duty; timezone/DST/shift changes and unscheduled-worker photo expiry.
- Location freshness timeout, maximum observation age/accuracy, and endpoint-online detection. Proposed offline/unreachable deadline must not become a queue.
- Late photo-upload finalization; changed ticket/worker access; photo request when worker is off duty or has no current shift.
- Gate ID retained fields and retention; visit closure, backup deletion schedule, ID notice/access controls, and applicable jurisdiction/company obligations.
- Offline cache/pending-draft TTL, lost-device handling, shared gate terminal identity, duplicate entries/check-out ordering, inventory reconciliation authority and disputed-balance presentation.
- Which optional company modules and provider approvals are already provisioned; default template mappings; partner-site grant approvers.
- Exact supported iOS/device matrix, Xcode/EAS versions, extension signing/APNs readiness, and physical-device test owners. Snapshot credentials are not current proof.
- Existing API providers/keys/contracts; approved company provider list; conversation/draft/AI audit retention; personal connection content saved into company records; speech fallback disclosure.
- Per-task consultation/retry/time/token limits; usage-alert thresholds/recipients; measured cost estimates and support staffing. No cap is authorized.
- Definition of valid scheduled on-call consent and company escalation timers/backup contacts; device receipt versus provider acceptance evidence.
- Architecture/dependency review before introducing unified V coordinator and broader offline execution. Do not silently equate conceptual feasibility with existing implementation.

Reference for cooperative V: [OpenAI agent tools/handoffs](https://developers.openai.com/api/docs/guides/agents), [MCP authorization](https://developers.openai.com/api/docs/guides/tools-connectors-mcp), [separate API billing](https://help.openai.com/en/articles/9039756-managing-billing-settings-on-chatgpt-web-and-platform). These support the proposed approach; no integration or shared private ChatGPT history has been verified by this interview.
