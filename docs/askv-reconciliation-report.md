# AskV implementation reconciliation

See the [September 7 TestFlight follow-up](askv-testflight-snag-two.md) for the
subsequent wake-warning, quiet-speaker and onboarding corrections. Earlier
build/test totals below describe the original reconciliation baseline.

Date: September 6, 2026. Branch: `codex/askv-cursor-reconcile`, based on Cursor's `d01cdf9`.

This branch implements the approved natural-voice design using Cursor's work as its starting point. The final uninterrupted automated regression chain passed on compatibility checkpoint `bd0538f`: 3,714 passed, 56 documented skips and zero failures. Under the subsequent full-ship authorization, source `95791e5` was published to main and deployed to web/API; iOS 1.0.1 build 157 finished and was successfully uploaded to App Store Connect, and its production OTA was independently verified. The production voice smoke then exposed a missing audit table; the surgical deployment repair is described below. Physical-device and field acceptance remain testing on the internal build.

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

Critical corrections include model-supplied confirmation bypasses, duplicate-write handling, missing server permissions and domain side effects, disconnected typed/voice histories, ignored client navigation/draft intents, navigation races, early idle timers, microphone ownership and cancellation, stale Gate recognition events, and private ticket-photo access. Continued validation also found ignored native source/build-preparation files and an audio packet flood during actual wake handoff; packaging is corrected and both clients now batch PCM into 50 ms packets. Full authenticated testing also exposed an unsupported Realtime tool field and an overlong web context ID; contract review found invalid assistant-history content types on both clients. All three provider compatibility defects are corrected and covered by regression tests.

## Verification evidence

Completed verification for the reconciled code:

- Full workspace `pnpm run typecheck`: passed for libraries, API, web, mobile, desktop and scripts.
- Full mobile Vitest suite: 97 files / 646 tests passed.
- Full API gate: 258 passing files / 2,107 passing tests, with 53 documented skips. Real PostgreSQL tests now cover authenticated signatures, concurrent greeting/transcript delivery, organization isolation, persisted confirmation and replay after module reload.
- Shared microphone/PCM suite: 8 tests passed. Native release-impact classifier: 7 tests passed.
- Locale parity: web 4,294 English/Spanish keys and mobile 1,745 English/Spanish keys passed after adding the five missing AskV runtime-error translations; focused locale/API-error suites passed 100 web and 106 mobile tests.
- Full web Vitest suite: 120 files / 874 tests passed, with 3 pre-existing skipped tests. The retained Gate sequential-plate fallback test passes in the full run after its recognizer restart timing was corrected.

Additional runtime evidence:

- Real shipped WASM/model inference: 9 of 9 cases passed, including two synthetic voices, Ask V with a question, V alone, unrelated speech and silence. The earlier incompatible model archive was replaced based on an actual inference failure.
- Real Edge capture test: one synthetic microphone, shipped AudioWorklet/worker/model, wake detection, buffered continuous handoff and track shutdown passed; no API call or off-device upload occurred.
- Native compilation: EAS build `1cfd7f1c-4e1c-49ce-9033-25b4e5fac9f7`, version 1.0.1 build 156, reached `FINISHED` with CLI exit 0 and a signed IPA. Exact source was `200ea71`; the later JavaScript batching/history fixes, translations and test-infrastructure patch were not in that binary. Native preparation, CocoaPods, Swift/Objective-C++ compilation, linking, signing and export passed. This is not physical-device acceptance or TestFlight submission.
- Final native packaging at `bd0538f`: local EAS archive inspection passed; all 43 selected required files matched source SHA-256, current module discovery and cached pinned-framework preparation passed, and real credential paths were excluded. This is packaging/preparation evidence, not a new native compile. See [native evidence](askv-native-build-validation.md).
- Production web bundle built successfully. Existing bundle-size and dependency sourcemap warnings remain non-fatal.

The original API regression subset uses mocked persistence/domain boundaries. New PostgreSQL-backed tests now exercise real transactions, authentication signatures, concurrent greeting/transcript delivery, organization boundaries and durable reservations; all five PostgreSQL integration cases pass. The original replay failure exposed JSONB decoding of serialized tool results; versioned result envelopes and completed-legacy compatibility fix it while pending/error reservations still fail closed.

Real provider verification now uses the production session builder and shipped browser client against OpenAI — no mocked WebRTC service. Opening greeting, VAD answer, typed follow-up, playback cancellation, local WASM wake handoff, actual spoken barge-in and capture shutdown passed. The sustained wake run lasted 67.2 seconds with one microphone/peer and no client errors. It exposed and verified the fix for tiny PCM packets flooding the data channel. The final compatibility corrections pass web 10 / mobile 9 focused transport tests and both app typechecks. This bridge test does not include authenticated application navigation, saved history, domain tools, five-minute owner timeout or physical iOS. See [live voice evidence](askv-live-voice-validation.md).

The separate [authenticated full-app check](askv-authenticated-live-validation.md) now passes on the corrected code: actual login and anonymous rejection, a persisted full daily greeting claim, automatic spoken answer, typed voiced follow-up, exact database-backed history after reload, persistent mute with no capture on reload, and unmuted conversation resumption. The provider acknowledged all three restored assistant messages and recalled the earlier synthetic confirmation. Eight messages remained in one conversation, with exactly two sequential microphone/peer sessions, zero API/provider failures and zero domain tool invocations. Browser, API, Vite, connection pool and synthetic-audio cleanup all passed. This uses a fresh local database and synthetic speech; physical iOS, real field actions and representative field conditions remain acceptance work.

The uninterrupted root `pnpm test` chain passed with exit 0 on `bd0538f`: **3,714 passed, 56 documented skips, zero failures**, including all 34 browser E2E scenarios. [Detailed evidence and skip accounting](askv-validation-evidence.md). A new password-protected local PostgreSQL 17.11 cluster and `fresh-local` test mode now create unique empty test databases with additive schema provisioning. They never reset/reuse an existing database. Canonical password drift tests simulate comparison failure without storing noncanonical passwords. No existing or shared database was reset or migrated during implementation validation. The temporary local PostgreSQL cluster is now stopped and its data is retained.
The original documentation checkout and Cursor checkout retain their original
unrelated local files and changes; implementation is isolated on the branch above.

## Release handoff

After the validation above, the user explicitly authorized an unattended full ship on September 6, 2026: commit/push/main, web, API with its guarded additive migration, iOS OTA and a final native build submitted to TestFlight. This report records the implementation preflight; production workflow results are recorded in the release handoff. Physical-device/field acceptance remains testing on the resulting internal build.

## Release verification

- Source `95791e537f28f3547bfca643ffdbdc317206a705` was published to main without rewriting history. The final app code is unchanged from the verified `bd0538f` runtime checkpoint.
- [Web Publish](https://github.com/vndrly/VNDRLY.ai/actions/runs/34081392103) and [API Deploy](https://github.com/vndrly/VNDRLY.ai/actions/runs/34081392094) succeeded. Public `/`, `/gate`, entry bundles and all pinned wake assets matched the exact web build artifact; the API was healthy and the guarded greeting migration completed.
- [iOS build and submission](https://github.com/vndrly/VNDRLY.ai/actions/runs/34081396462) succeeded: version 1.0.1 build 157, EAS build `1622ae9c-e3e9-48f2-89e6-34bf63d19eaf`, submission `118b6e46-56b5-417e-92f1-e80bf392bb49`. App Store Connect upload completed September 7 at 04:09:29 UTC. Apple processing/tester availability is separate from upload success.
- [Production OTA](https://github.com/vndrly/VNDRLY.ai/actions/runs/34081950528) succeeded and was independently read back: runtime 1.0.1, iOS, group `d144c043-9426-4ff9-a1ab-1e0074befa3c`, exact source `95791e5`. The workflow also passed all 646 mobile tests.
- The internal natural-voice pilot is enabled for the canonical demo accounts. Existing credentials were preserved.
- A production smoke found `public.assistant_action_audit` missing before the first provider connection. Its existing checked-in table/index migration was absent from both deployment paths. The follow-up adds an exact guarded migration and access restrictions before API restart; production audio verification must pass after that repair. No existing database is reset, restored or reseeded.
- The repair passed seven focused migration/deployment checks and two real PostgreSQL migration runs in a new local database. The existing synthetic audit row survived; inherited and deliberately reintroduced browser grants were revoked. Actual `anon` and `authenticated` reads, inserts and sequence calls were denied in all six cases. The local cluster is stopped with test data retained.

## Remaining acceptance work

During internal TestFlight acceptance, before wider rollout ([test worksheet](askv-testflight-acceptance.md)):

- Test physical iPhone/iPad speaker and wired/Bluetooth audio, phone interruptions, microphone allow/deny/revoke, screen lock, foreground changes and slow/offline connections.
- Validate Gate check-in/out and field actions, confirmation/correction, mixed voice/typing, navigation and five-minute playback-based idle in the actual app.
- Measure real names, license plates, accents and noisy gate/truck conditions, plus false wakes, latency, fallback, duplicates and cost. Keep the legacy Gate path until parity is demonstrated.

Metrics are estimates, not provider billing. Empty wake sessions and explicit correction phrases provide heuristic signals; representative field testing is necessary to establish real false-wake and recognition rates. The native wake layer targets foreground iOS; Android/background wake is not included in this approved scope. Pending approval/context state is process-local and fails closed after restart; multiple API instances need session affinity until that transient state is shared.

See [backend contracts](askv-backend-contract.md), [asset provenance](askv-local-wake-assets.md), and [implementation plan](superpowers/plans/2026-09-06-askv-local-wake.md).
