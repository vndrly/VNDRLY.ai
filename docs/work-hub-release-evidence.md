# Work Hub release evidence

Date: 2026-09-09

## Included

- Guarded additive Work Hub flags and collaboration, work, schedule, meeting, connector, search, notification, retention, and audit schema.
- Context-capability authorization, opaque cross-tenant failures, idempotent commands, version conflicts, private files, SSE events, notification preferences, search, and personal Home aggregation.
- Developed web destinations for Channels, Calendar, Files & Notes, Tasks & Forms, Meetings, Search, and Settings, including administrator creation/assignment, reusable templates, announcements, acknowledgements, ordered approvals, monitoring, and participant completion/submission views.
- iOS Work Hub reads the same tenant-safe records, supports quick creation for core operational records and replay-safe task completion, and retains a reliable return to the main VNDRLY experience.
- One shared web/iOS AskV Work Hub toolbox; consequential writes use the existing confirmation and audit path.
- Public commercial homepage and a separate curated public AskV boundary with no authenticated tools or history.
- API deployment runs all Work Hub migrations in order.
- Post-review hardening scopes Gate Supervisor task/shift management to assigned gate/site contexts, validates every mutation target against the owning organization, serializes open-shift claims, preserves channel-delete idempotency, and binds file reservations to the authorized channel owner.

## Verification on the release tree

- `pnpm lint:i18n`: pass (web 4,399 keys per locale; mobile 1,751 keys per locale).
- `pnpm run typecheck`: pass.
- `pnpm test`: pass on the exact implementation tree: web 144 files / 954 passed / 1 skipped; mobile 101 files / 675 passed; API 270 files passed / 16 skipped and 2,268 tests passed / 108 skipped; Chromium 34/34.
- API and browser suites ran against isolated `postgres_test` with a non-routable test AI endpoint.
- Production web build: pass.
- Flags, core, domains, and notification migrations each passed two consecutive applications against `postgres_test`; the additive Microsoft import migration also passed twice.

## 2026-09-09 batch reconciliation verification

- `pnpm lint:i18n`: pass (web 4,399 keys per locale; mobile 1,751 keys per locale).
- `pnpm run typecheck`: pass across libraries, API, web, mobile, commercial, desktop, sandbox, and scripts.
- Shared-library tests: pass (57 tests across AskV wake, API contracts, 1099, Gate, Majik, and plate-state packages).
- Web: 146 files passed; 966 tests passed and 1 skipped.
- Mobile: 102 files passed; 677 tests passed.
- API: 278 files passed and 10 skipped; 2,287 tests passed and 98 skipped against the isolated `postgres_test` database.
- Chromium E2E: 34/34 passed against the isolated `postgres_test` database.
- Mandatory aggregate `pnpm test`: pass across the complete library, web, mobile, isolated API, and Chromium chain.
- API production typecheck and bundle: pass.
- Review fix commit: `d05d64f1127177bc7a71a90a503711cdabb730b2`.
- Detailed implementation-versus-design status: `docs/work-hub-batch-reconciliation.md`.

## Controlled rollout and known external work

- Work Hub remains false-default and can be rolled back by flag without reverting schema.
- Audio meetings are safe-disabled. Provider approval, credentials, data-processing review, signed webhooks, and physical iPhone/iPad audio-route testing remain before recording or transcription can be enabled. See `docs/decisions/work-hub-audio-provider.md`.
- Microsoft 365 is a one-way, staged migration source by contract and remains safe-disabled. Import batches/items preserve provenance, external IDs and versions, permission/conflict snapshots, progress, activation targets, and errors. Azure registration, OAuth credentials, callback verification, provider category mapping, and physical import validation remain before enablement. VNDRLY never writes back to Microsoft.

## Production completion fields

### Integrated native-capture candidate (not yet released)

The local release worktree merges remote `abb82e81` with checkpoint `105fb3e7`. This section supersedes the old disabled-provider description for the new meeting transcription endpoint only, not the entire Ask V assistant.

- Whole-workspace typecheck passes; web locale 4,400 keys and mobile 1,751 keys match English/Spanish.
- Full web suite: 164 files, 1,054 tests passed, 1 skipped. Subsequent recording-format/timing corrections pass all 32 affected meeting tests.
- Merged mobile suite: 105 files, 685 tests passed; no physical-device acceptance inferred.
- Native helper and meeting API: 69 tests passed, 5 database-backed capture tests skipped locally; these skips are not passing security evidence.
- API production bundle passes. Eight native-provisioning/deployment guard tests pass.
- Required fresh-database API and browser gates for this integrated candidate are still pending CI. No live database reset is authorized or performed.
- Self-hosted engine and model installation completed, but the captured VPS benchmark failed live-transcription capacity. On the existing one-core, approximately two-GiB server, concurrent public-sample jobs exceeded the 30-second guard. A single one-thread greedy decode correctly transcribed an 11-second public sample in 20.97 seconds (about 1.91 times the audio duration), with approximately 238 MiB peak resident memory. This is slower than real time, not an operational pass. The provisioner left native transcription disabled, did not restart the API, and public API health remained `ok` during that run. No customer audio was used. A larger host or an explicitly approved external transcription integration still needs a representative latency/concurrency test; no hosting purchase or provider switch has been made.
- Native iOS capture, synchronized replay trial, meeting Ask V answers/private retrieval, summary generation, full governance/load/device acceptance, and exact new-release deployment tracks remain open. A successful compilation is not a completed full ship.

### Meeting-answer display continuation (local, not shipped)

- Added the approved temporary answer card, preserving exact saved text in the timeline after the card expires. Private V answers now identify the other participant and do not borrow a human requester's photo.
- Added a message-type check so answer provenance cannot become a broken file download. Real image/file previews remain intact. Added client-side private-audience filtering as defense in depth; server authorization is still required.
- Initial display regressions failed before implementation; the implementation then passed 19 workspace tests, all 39 related meeting tests, and the web typecheck. Independent review subsequently found that timeline search/speaker filters can suppress the temporary answer card; the correction and final verification are still in progress. These checks are not evidence that live answer generation works.
- The API answer implementer added tests only. Automated approval review stopped the proposed transfer of saved meeting text to the configured Anthropic service. Explicit permission for shared/private meeting text has been requested and is unanswered. The new answer endpoint/helper are not implemented, and their 21 route / 6 helper regressions remain failing. Do not omit those requirements or claim a green release gate by excluding them.
- A standalone local PostgreSQL test runtime is being evaluated to unblock exact-tree database checks. This is separate from production Supabase; no existing database is a reset target.

### Encrypted offline and representative-load continuation (local, not shipped)

- Added a scope-isolated iOS Work Hub mutation queue backed by SQLCipher, with its random key stored in the device secure store. Attachment bytes stay in application-private document storage until confirmed upload; the queue never imports the earlier global AsyncStorage record.
- Connected queued creates, task completion, channel and meeting messages, and meeting file uploads. Stable operation identifiers, bounded capacity, dependency order, concurrent-operation serialization, backoff, retry delay headers, conflict retention, permanent-failure retention, corrupt-record preservation, and authorization revocation all have focused regression coverage.
- Final mobile evidence: 5 focused files / 77 tests passed, followed by the complete 120-file / 935-test mobile suite, mobile typecheck, locale parity, Expo SQLCipher configuration inspection, and clean diff check apart from repository line-ending notices.
- Representative load evidence: 5,000 recipient-isolated event deliveries across 500 subscribers and deterministic generation of a checksummed 10,000-row CSV artifact both completed inside the five-second test budget. Together with provider admission coverage, 2 files / 18 tests passed.
- The current AssemblyAI trial is explicitly capped at five simultaneous streams by default, matching the measured account boundary. The sixth request returns a retryable busy result without reaching the provider. An environment override can raise the cap only up to the server safety ceiling after upgraded-account capacity is measured.
- This is exact-source local evidence, not publication evidence. Final integrated gates, cloud native compilation, live deploy, OTA, and TestFlight submission remain required.

- Release commit:
### Streaming-provider continuation (local integration, not released)

- Supersedes the earlier provider-choice status: the user explicitly chose AssemblyAI STT rather than increasing VPS capacity, and authorized trial use. First-party WebRTC/relay transport remains unchanged. No hosting upgrade or provider package purchase was made.
- Server-key authentication succeeded; the secret remains outside the repository and was never printed or exposed to the browser.
- Actual public-sample check: two concurrent AssemblyAI v3 streams, universal-streaming-multilingual, mono PCM16 at 16kHz, sent at real-time speed. Pinned whisper.cpp v1.7.6 JFK WAV SHA256: `59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e`. Eleven seconds of speech plus two seconds of silence per stream. Both returned three final turns and the exact expected 22-word transcript (word error rate 0); first text appeared 1.333/1.338 seconds after Begin. Both ended cleanly with provider Termination reporting 13 audio seconds / 14 session seconds. Probe exited 0. No customer or microphone audio was used.
- This is provider feasibility evidence only. App-path, iPhone, long-running, noisy-audio, overlapping-speaker and ten-person load acceptance are NOT established by this sample. The streaming code still needs integration tests and independent review.
- Live participant-audio enablement remains unresolved and disabled; do not infer permission to conceal third-party processing/training from audio-capture authorization. No extra consent UI or automatic provider policy-version bump is being added. No privacy-document changes were made in this continuation.
- Display-review correction now passes 22 focused workspace tests; independent review returned specification PASS and quality PASS. Latest-answer selection preserves audience/private-thread restrictions and is no longer suppressed by transcript search/speaker filters. Full web suite before this final three-test fix passed 164 files / 1060 tests, with one skipped; exact integrated release gates remain pending.
- Participant-photo resolver passes 3 tests; route integration remains unapproved and its 2 new tests fail as expected. Anthropic answer-generation approval remains separately unresolved; its previously recorded failing tests have not been hidden.
- The verified official local PostgreSQL installer requires Windows elevation, so that route did not produce a running test database. No real database was changed. The established CI fresh-local database path remains available.

### New full-ship evidence (pending)

- Independent review found five blocking server defects despite the initial 19 passing tests. Two test-first fix rounds now pass 25 focused tests. Scoped re-review accepted the fixes for authorization at delayed forwarding, outgoing backpressure, post-acknowledgement deduplication, response-close cancellation and timestamp validity, including a second disposal/authorization race. A further capability regression now brings the backend focused total to 26 passing tests; selected-but-unavailable streaming no longer advertises a native fallback.
- The completed browser integration initially passed 52 focused tests. Independent integration review found four Important defects: a cancelled start could lose its cleanup handle, AudioWorklet messages could accumulate before the main-thread queue, downsampling lacked anti-alias filtering, and process exit could precede provider cleanup. Two further test-first rounds fixed these; independent scoped reviews accepted all findings. Round 3 passed 16 browser tests and 28 combined API tests. Round 4 additionally reproduced and fixed three already-disposing/concurrent/scoped shutdown cases, passing 16 manager/shutdown tests. Local streaming code review is complete, not live capacity/privacy/device acceptance.
- An independent three-file compiler repair review passed. The web typecheck now passes, with 23/23 workspace and 3/3 photo-helper tests. API typecheck fails only on the intentionally missing meeting-answer helper. All six answer-helper cases still fail for that missing implementation; none were skipped or replaced by a dummy. The exact integrated tree still has no full verification pass.
- A second public-sample probe exercised the actual server manager (not just raw WebSocket): 3 final turns, exact expected words, valid relative timestamps, stable identity across ordinary unacknowledged retries; first final at 3.529 seconds. Exit 0. No app route, database or participant audio was used. This does not resolve the review defects.
- Current public root, /gate and /api/healthz returned 200, with API status ok. GitHub main is still abb82e811b43e93036c4e46dc6c33c52b4a3b757. The earlier successful TestFlight run 34363527714 built/submitted 76db4fc009fdf77416f77c1285a6c22021f1f905; it is not evidence of this update shipping.
- iOS source inspection confirms native per-attendee streaming capture is absent; its current audio room relies on a web host's mixed-audio capture. Implementing that path and testing it on-device remain required.
- A ten-stream public-sample probe failed its capacity gate: six streams returned exact words (WER 0), four were rejected before Begin with WebSocket code 1008. Successful first partials took 1.324–1.359 seconds; each successful session reported 13 audio seconds and 14 session seconds. All connections ended. The current [AssemblyAI account documentation](https://www.assemblyai.com/docs/faq/how-to-get-your-api-key) lists free-tier stream-start limits; this is consistent with the rejection but the exact close reason was not captured. No billing or account-limit change was made, and ten-person transcription is not verified.
- The configured Xcode simulator tool failed with `spawn xcrun ENOENT`. No local Apple simulator is available through that tool; native compilation and physical microphone/headset evidence remain missing.
- Native lifecycle inspection also found that the current audio room does not stop owned peers/tracks on authorization-loss polling errors and does not use the shared microphone coordinator. A bounded local cleanup repair is now assigned; it is not the missing native transcription adapter.

### Fresh local web verification after streaming review

- Full web suite: exit 0, 167 files passed, 1,082 tests passed and one skipped in 213.13 seconds. Two browser-simulation warnings (`Not implemented: navigation to another Document`) were emitted; their source was not established. No warning-free claim.
- Locale parity: pass, web 4,400 and mobile 1,751 keys per English/Spanish locale.
- Production web build: pass, 3,757 modules, 16.16 seconds. Source-map reporting warnings on five UI modules and a large-bundle warning remain. This was not a deployment.
- The built and source AudioWorklet have matching SHA256 `6DDDA765C7BCF92358DF8050C6AA296EBD8553BCD8460F9C28ED6C8FA2E8A3E9`. A real temporary headless Chrome test loaded the built asset from loopback using only generated 1 kHz audio: 24 acknowledged chunks with zero overflow, or 16 chunks and one terminal overflow when acknowledgements were withheld; both zero-output nodes captured the expected nonzero signal at 48 kHz. Corrected harness exited 0. No microphone, provider, database or user's browser profile was used.
- Native lifecycle initial implementation passed 36 mocked component tests, 63 focused/adjacent tests, eight coordinator tests and mobile typecheck. Independent review found a late-native-acquisition cleanup exception not covered by that run; a scoped test-first repair is in progress, so local task acceptance is still pending. This does not implement native PCM transcription or prove physical iPhone behavior. No new release commit, main advancement, deploy, OTA or TestFlight submission is established by these checks.
- Subsequent native cleanup fix reproduced the cancelled-late-capture exception, then passed 37/37 component tests and mobile typecheck. Independent scoped re-review accepted it (specification PASS, quality Approved, no remaining Important/Critical findings). Local native lifecycle cleanup is now accepted; native PCM/STT/replay implementation and physical-device validation remain outstanding.
- Follow-up ten-stream provider diagnosis: five completed the same pinned public sample with WER0 and first text1.315–1.357 seconds; five were rejected before Begin with explicit provider error 'Unauthorized Connection: Too many concurrent sessions'. Probe exited1, all connections ended. This identifies a concurrent-session restriction for this test, replacing the earlier unproven stream-start-limit explanation; it does not verify upgraded capacity. No participant audio, billing/account change or live configuration change.
- Native SDK decision evidence confirms no supported default-microphone PCM observer in installed Jitsi124's public track/source/session interfaces. Preserving AskV's default audio would require a dedicated meeting-only native media/peer bridge using the supported custom audio-device interface. This is a major architecture decision, not yet implemented, compiled or tested on-device.

### Gate contextual Ask V and review corrections (local, not shipped)

- The Gate voice entry path now uses an allowlisted local draft context containing only visible form values and the selected site's visible name/address. It can answer a duration question without changing or submitting the draft. Missing duration/site context returns clarification, and a site or authorization change invalidates an in-flight result.
- Spoken host selection is restricted to the currently loaded, authorized visible options for the selected site. Exactly one normalized match may be applied; ambiguous or missing matches request clarification. Host keys and other hidden identifiers are not included in the Ask V context.
- Duplicate callbacks carrying the same recognition-delivery identity are deduplicated, while a later result in the same continuous listening session or a later microphone capture may repeat the same valid request. Questions cannot also execute as commands. Recognition remains active across successful utterances and recoverable no-speech errors until explicit toggle-off or an existing lifecycle/access boundary, and the shared microphone coordinator prevents global voice and Gate voice from owning two listeners.
- OCR memory restore now requires both plate and state confidence to meet the approved threshold. A low plate-confidence result cannot restore a prior identity/company merely because the state is confident. Spoken-driver parsing also recognizes `state` as the next-field boundary and keeps a trailing duration out of purpose text.
- Gate card sizing now accounts for viewport height as well as width: short-wide/landscape surfaces use the responsive height while ordinary desktop retains the 560px cap and 75/25 content regions with the history action anchored below.
- TDD evidence includes failing-first contextual-answer, parser, confidence, short-wide viewport, and later-capture repeat regressions. Final focused Gate verification passed 6 files / 82 tests; the complete Gate suite passed 25 files / 183 tests. The most recent full web baseline before the final delivery-scoping correction passed 169 files / 1114 tests with one skipped and was not rerun for this correction. Web typecheck and English/Spanish parity passed (mobile 1855/1855; web 4426/4426). These are local checks only and do not establish deployment, live provider use, or production-data changes.

- Release commit:
- GitHub main:
- Web Publish:
- API Deploy and `/api/healthz`:
- Supabase migrations/storage:
- Expo OTA update group:
- TestFlight build/submission:
- Commit-to-public-web elapsed time:
