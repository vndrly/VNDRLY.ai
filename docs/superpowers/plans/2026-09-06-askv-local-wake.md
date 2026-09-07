# AskV Local Wake Implementation Plan

**Goal:** Reconcile Cursor's first implementation with the complete approved natural-voice scope, including local Ask V wake detection, web/iOS conversation ownership, Gate/field tools, safe confirmation, persistence, and rollout verification.

**Architecture:** A bundled sherpa-onnx keyword model runs in a browser worker or a small native Expo module. VNDRLY owns microphone arbitration, opt-in preferences, bounded in-memory audio, activation, foreground cleanup, and the existing Realtime conversation handoff.

**Spec:** ../specs/2026-09-06-askv-natural-voice-behavior-design.md. Gate and core field operations are included. The spec's broader office/financial mutations and background/locked-screen wake remain deferred.

## Constraints

- Across-VNDRLY wake is opt-in and disabled by default. Opening AskV starts voice unless the user has persisted mute. No SpeechRecognition cloud fallback for wake detection.
- Only Ask V activates; the letter V alone does not.
- No wake-idle audio leaves the device; buffered audio after activation is transient and cleared on cancellation.
- The microphone has one owner. Mute, background, logout, account/membership changes cancel pending startup and capture.
- Model/runtime assets are pinned, bundled, and attributed. No runtime CDN or wake API calls.
- Implementation validation used only new local test databases with additive provisioning and synthetic fixtures. On September 6, after validation, the user explicitly authorized an unattended full ship including web/API, the guarded additive production greeting migration, iOS OTA and final native build/submission. Existing/shared database resets, destructive changes and credential rotation remain excluded.

## Execution

- [x] Pin model/runtime assets and verify actual model inference from audio.
- [x] Add shared bounded PCM buffering, resampling and exclusive microphone ownership with regression tests.
- [x] Implement browser worker detector and AudioWorklet capture; verify cancellation, exact-once handoff, and real Edge synthetic-microphone capture.
- [x] Implement native iOS module with sherpa-onnx and foreground/audio-interruption cleanup. The native baseline compiled successfully as build 156; a final release binary and hardware acceptance remain release gates.
- [x] Wire opt-in controls, visible state, persistent mute and authentication/organization isolation into both applications.
- [x] Integrate buffered wake speech with Realtime; prevent duplicate calls and microphone overlap, including legacy Gate and push-to-talk.
- [x] Reconcile Gate/field server tools, existing entry forms, actual-user confirmation, durable idempotency, permissions and private photo access.
- [x] Preserve typed/voice history, recover failed transcript saves, serialize navigation context, retain office read queries, and implement rollout controls and metadata-only metrics.
- [x] Finish available integrated verification and record exact evidence in `docs/askv-reconciliation-report.md`: full typecheck, web/mobile suites, safe API subset, shared audio tests, locale/build checks, and real browser/model execution.
- [x] Complete database-backed API and Playwright gates using new local databases: full root chain passed on `bd0538f`, 3,714 tests passed / 56 documented skips / zero failures; no existing database reset.
- [x] Complete authenticated full-app live voice and saved-history resumption with actual provider audio, real login/SQL persistence, persistent mute and sequential microphone ownership.
- [ ] Produce the final native release binary and complete physical-device/field acceptance before wider production rollout; retain Gate fallback until parity is demonstrated.

## Progress and decisions

- Isolated branch: `codex/askv-cursor-reconcile`, based on Cursor's `d01cdf9` (`feat/askv-natural-voice`). The original docs checkout and Cursor checkout are preserved. Implementation worktree: `C:/Users/JohnElerick/AppData/Local/Temp/vndrly-askv-local-wake-20260906`.
- Ruling: use upstream native C API in an Expo module instead of the latest general-purpose React Native wrapper; that wrapper targets newer Expo/RN and brings capabilities unrelated to wake detection.
- Browser uses pinned local WASM runtime, never its upstream default CDN loader.
- Actual inference rejected the fixed-shape upstream `-mobile` archive; both platforms now bundle the verified standard 3.3M model. Provenance and hashes are in `docs/askv-local-wake-assets.md`.
- OpenAI Realtime is the active-conversation provider already specified in the approved scope. This implementation adds no hosted wake-word service.
- iOS runtime version is isolated at app version 1.0.1. Module/model/build-preparation changes require a native build, not an OTA update to older binaries.
- Independent review found and corrected model-forged approval, stale context requests, transcript save loss, response-generation/playback timing confusion, and capture starting after cancellation. Retained Cursor code is covered by integrated regression checks rather than assumed correct.

### Continued validation

- Packaging checkpoint `200ea71` includes the previously ignored native module sources and required EAS preparation script. EAS build 156 for this exact baseline reached `FINISHED` and exported a signed IPA; nothing was submitted to TestFlight.
- Real OpenAI/browser validation found capture callbacks flooding the Realtime data channel. Web and iOS now send bounded 50 ms PCM packets; decoded-audio/order/cancellation regressions and live wake handoff plus spoken interruption pass. The final JavaScript fix requires inclusion in the eventual release build.
- A new local PostgreSQL cluster and guarded fresh-only test mode allow database integration without resetting an existing database. The full uninterrupted root chain now passes; the reconciliation report and `docs/askv-validation-evidence.md` record exact results and skip accounting.

- Real PostgreSQL replay testing found JSONB double-decoding of serialized tool results. A versioned output envelope now preserves exact results, reads completed legacy rows, and keeps pending/error reservations uncertain. All 14 persistence cases and five real database integration cases pass.
- Full-app provider validation exposed unsupported `session.tools[].strict` and a 36-character web context item ID above the 32-character provider limit. Independent contract review also found assistant history must use `output_text`. All are corrected at `bd0538f`; focused API 15 / web 10 / mobile 9 tests and actual signed-in/resumed audio conversations pass.

- Final EAS archive at `bd0538f`: 43 required files matched source hashes; current module discovery and pinned native preparation passed. Final automated root run passed 3,714 tests with 56 documented skips in 10m12.104s. The test cluster is stopped with data retained.
