# AskV implementation reconciliation

Date: September 6, 2026. Branch: `codex/askv-cursor-reconcile`, based on Cursor's `d01cdf9`.

This branch implements the approved natural-voice design using Cursor's work as its starting point. It has not been deployed, merged, or shipped to TestFlight. The native compilation baseline and live web provider checks now pass. Final-tree regression, authenticated application acceptance and physical-device checks remain release gates; a successful build is not a TestFlight submission.

## Scope coverage

| Approved behavior | Final implementation and evidence |
| --- | --- |
| Open once, greet, listen, answer automatically, keep talking | Root web/iOS session owners, OpenAI WebRTC, VAD automatic response, real playback events, multi-turn and interruption tests |
| First full greeting per local day across devices | Atomic server daily claim, timezone handling, existing additive migration; concurrency tests |
| Typed and spoken turns in one conversation | Server conversation/session binding, transcript deduplication, retry queues that retain failed saves, typed Realtime input and existing typed fallback |
| Persistent mute; one microphone; stop on identity/foreground loss | Per-user device preferences, generation/abort guards, shared microphone coordinator, Gate/PTT arbitration, late permission/recording cancellation tests |
| Five-minute idle after playback | Actual output-buffer stop arms idle; function calls and cancelled responses do not count as finished playback; wake silence remains bounded |
| Foreground opt-in wake with no hosted wake API | Bundled sherpa-onnx models, browser Worker/AudioWorklet and native Expo AVAudioEngine module; exact Ask V keyword; no V-only activation |
| Preserve speech through wake activation | Same capture source, two-second pre-roll, bounded connecting buffer, incremental PCM transfer, zeroing/cleanup and overload rejection |
| Navigation and compact context | Authenticated shared providers, serialized latest-context updates, server-normalized route/record/role/organization, bounded selectable tool packs |
| Existing office read queries | Role-scoped read-only workflow packs remain discoverable; broader office/financial mutations stay deferred |
| Gate check-in/out and field lifecycle operations | Canonical permissions, site/GPS/validation/status transitions and side effects; pending summaries and genuine user confirmation; legacy Gate fallback retained |
| Photos, parts, labor, mileage and safety drafts | Actual existing web/iOS entry surfaces, reviewed submission, private-photo access checks, no invented readings or automatic draft submission |
| Safe execution and duplicate protection | Exact user/org/session/action/arguments confirmation binding; latest saved user event is approval evidence; durable reservations and replay; uncertain outcomes refuse blind repetition |
| Rollout and measurements | Server kill switch and pilot allowlist, pre-microphone capabilities check, metadata-only metrics, token estimates, native release classification and runtime isolation |

## What survived from Cursor

The overall Realtime direction, greeting migration, preference/UI starting points, tool-pack scaffolding, native WebRTC dependency/plugin setup, and separate Gate fallback remain. Their boundaries and behavior were corrected where review or testing found gaps. The local wake implementation is a real bundled inference/capture path; a phrase matcher alone is not treated as a working wake engine.

Critical corrections include model-supplied confirmation bypasses, duplicate-write handling, missing server permissions and domain side effects, disconnected typed/voice histories, ignored client navigation/draft intents, navigation races, early idle timers, microphone ownership and cancellation, stale Gate recognition events, and private ticket-photo access. Continued validation also found ignored native source/build-preparation files and an audio packet flood during actual wake handoff; packaging is corrected and both clients now batch PCM into 50 ms packets.

## Verification evidence

Completed verification for the reconciled code:

- Full workspace `pnpm run typecheck`: passed for libraries, API, web, mobile, desktop and scripts.
- Full mobile Vitest suite: 97 files / 644 tests passed.
- Focused API regressions: 18 files / 82 tests passed; permission, confirmation, idempotency, persistence, context, metrics, mutation refresh and private-photo boundaries included.
- Shared microphone/PCM suite: 8 tests passed. Native release-impact classifier: 7 tests passed.
- Locale parity: web 4,294 English/Spanish keys and mobile 1,745 English/Spanish keys passed after adding the five missing AskV runtime-error translations; focused locale/API-error suites passed 100 web and 106 mobile tests.
- Full web Vitest suite: 120 files / 872 tests passed, with 3 pre-existing skipped tests. The retained Gate sequential-plate fallback test passes in the full run after its recognizer restart timing was corrected.

Additional runtime evidence:

- Real shipped WASM/model inference: 9 of 9 cases passed, including two synthetic voices, Ask V with a question, V alone, unrelated speech and silence. The earlier incompatible model archive was replaced based on an actual inference failure.
- Real Edge capture test: one synthetic microphone, shipped AudioWorklet/worker/model, wake detection, buffered continuous handoff and track shutdown passed; no API call or off-device upload occurred.
- Native compilation: EAS build `1cfd7f1c-4e1c-49ce-9033-25b4e5fac9f7`, version 1.0.1 build 156, reached `FINISHED` with CLI exit 0 and a signed IPA. Exact source was `200ea71`; the later JavaScript batching fix and test-infrastructure patch were not in that binary. Native preparation, CocoaPods, Swift/Objective-C++ compilation, linking, signing and export passed. This is not physical-device acceptance or TestFlight submission.
- Production web bundle built successfully. Existing bundle-size and dependency sourcemap warnings remain non-fatal.

The original API regression subset uses mocked persistence/domain boundaries. New PostgreSQL-backed tests now exercise real transactions, authentication signatures, concurrent greeting/transcript delivery, organization boundaries and durable reservations; their final gate result is recorded below when complete.

Real provider verification now uses the production session builder and shipped browser client against OpenAI — no mocked WebRTC service. Opening greeting, VAD answer, typed follow-up, playback cancellation, local WASM wake handoff, actual spoken barge-in and capture shutdown passed. The sustained wake run lasted 67.2 seconds with one microphone/peer and no client errors. It exposed and verified the fix for tiny PCM packets flooding the data channel. Web 9 / mobile 8 focused transport tests and both app typechecks pass. This bridge test does not include authenticated application navigation, saved history, domain tools, five-minute owner timeout or physical iOS. See [live voice evidence](askv-live-voice-validation.md).

The complete root `pnpm test` chain remains outstanding while the continued database/browser gates run. A new password-protected local PostgreSQL 17.11 cluster and `fresh-local` test mode now create unique empty test databases with additive schema provisioning. They never reset/reuse an existing database. Canonical password drift tests simulate comparison failure without storing noncanonical passwords. No existing or shared database was reset or migrated.
The original documentation checkout and Cursor checkout retain their original
unrelated local files and changes; implementation is isolated on the branch above.

## Required before release

1. Build the iOS 1.0.1 native binary and validate it in TestFlight. Test speaker, wired/Bluetooth audio, phone interruption, permission allow/deny/revoke, screen lock, background/foreground, and slow/offline connections on physical iPhone/iPad.
2. Run an authenticated real Realtime conversation against the configured provider: opening greeting, automatic answer/follow-up, barge-in, mixed typing/voice, saved history, navigation and five-minute playback-based idle. Validate names, license plates, accents and noisy gate/truck conditions.
3. Run the required API/database and browser end-to-end gates against an explicitly disposable test database. The repository's test wrapper drops its test schema; it was not run against the shared Supabase configuration under the no-database-wipe rule.
4. Deploy the guarded additive greeting migration and web/API/native changes under a release command, enable an internal pilot with `ASKV_NATURAL_VOICE_USER_IDS`, and inspect latency, false activation, fallback, duplicate and cost observations. Retain the legacy Gate path until full parity is demonstrated.

Metrics are estimates, not provider billing. Empty wake sessions and explicit correction phrases provide heuristic signals; representative field testing is necessary to establish real false-wake and recognition rates. The native wake layer targets foreground iOS; Android/background wake is not included in this approved scope. Pending approval/context state is process-local and fails closed after restart; multiple API instances need session affinity until that transient state is shared.

See [backend contracts](askv-backend-contract.md), [asset provenance](askv-local-wake-assets.md), and [implementation plan](superpowers/plans/2026-09-06-askv-local-wake.md).
