# Internal Call Transcripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Provide internal vendor call transcripts and automatic readable voicemail without sending audio to external speech services.

**Architecture:** Add a vendor policy boundary to the existing call service and a bounded local PCM transcription adapter using the existing FFmpeg/Whisper engine. Preserve voice transport independently of speech processing. Reuse transcript storage with call-specific authorization.

**Tech Stack:** TypeScript, Express, Drizzle, React Native, existing local FFmpeg and Whisper executables.

**Spec:** ../specs/2026-10-14-internal-call-transcripts.md

## Global Constraints
- No per-call approval dialogs; vendor administrator policy controls internal calls.
- No external speech provider or fallback.
- Preserve device lease, authenticated speaker identity, tenant isolation and audit history.
- Additive guarded migrations only; no reset, credential changes or manufactured consent records.
- Recent exposes saved transcript links; Missed stays unchanged; voicemail text is automatic alongside playback.

## Review Focus
- Membership revoked during capture stops transcription immediately.
- Speech engine failure never drops the voice call.
- Duplicate frames or voicemail retries never duplicate saved text.
- Short final speech is flushed when a call ends.
- Organization switching cannot reveal another vendor's transcript.

### Task 1: Vendor policy and call authorization
**Files:** Modify `artifacts/api-server/src/routes/workHubCalls.ts`; create `artifacts/api-server/src/work-hub/call-transcript-policy.ts` and its test; extend the existing Work Hub DB schema and guarded migration.
**Interfaces:** `authorizeCallTranscript(actor, callId, mode: "read" | "capture")` returns authorized vendor and occurrence IDs or refuses access.
- [ ] Test same-vendor participants, authorized vendor administrators, external contacts, revoked membership and organization switching.
- [ ] Implement vendor policy version, verifier and effective date; revalidate membership for each capture/read.
- [ ] Run focused API tests against an isolated database and inspect additive migration SQL.

### Task 2: Local streaming speech adapter
**Files:** Create `artifacts/api-server/src/work-hub/local-call-transcription.ts` and its test; reuse `native-transcription.ts`; modify call audio endpoints in `workHubMeetings.ts` without weakening meeting consent rules.
**Interfaces:** `appendCallAudio(sessionId, sequence, pcm)` acknowledges ordered frames; `closeCallAudio(sessionId)` flushes final text. Session creation requires Task 1 authorization and an active audio lease.
- [ ] Test reordered/duplicate frames, silence, short tail flush, bounded queues and missing executables.
- [ ] Implement rolling local chunks and authenticated server timestamps; isolate speech errors from voice transport.
- [ ] Test policy revocation and call end during in-flight inference; discard results after authorization expires.

### Task 3: Saved transcripts and automatic voicemail
**Files:** Modify `workHubCalls.ts`; create `artifacts/api-server/src/work-hub/call-voicemail-transcription.ts` and its test.
**Interfaces:** Call history reports transcript availability; authenticated call transcript read returns speaker-labeled segments. Voicemail upload queues local processing with processing/ready/failed/unavailable states.
- [ ] Test duplicate upload/retry identities, private audio ownership, unauthorized reads and local-engine failure.
- [ ] Replace the external manual voicemail transcription path for this policy with bounded automatic local processing; preserve playback on failure.
- [ ] Verify canonical saved segment readback and no external provider invocation.

### Task 4: Mobile live and saved transcript surfaces
**Files:** Modify `WorkHubCalls.tsx`, `WorkHubAudioRoom.tsx`, `lib/native-meeting-audio.ts`, their tests and English/Spanish locales.
**Interfaces:** Consume Task 3 transcript availability/state and existing authenticated streaming frame protocol routed to Task 2.
- [ ] Test Recent transcript links, unchanged Missed rows, readable voicemail text, iPad/phone live cards and speech failure with continuing voice.
- [ ] Add speaker/time/search/selectable text and visible transcription on/paused state; remove manual voicemail Transcribe action for automatic processing.
- [ ] Verify sign-out/context changes clear private transcript state and stop capture.

### Task 5: Runtime and integration verification
- [ ] Check configured local binaries/model without printing secrets; report missing runtime rather than substituting a provider.
- [ ] Run mobile/API focused tests, typecheck and locale parity.
- [ ] Verify two-device native capture, end-of-call flush and saved readback using synthetic calls before claiming live readiness.
- [ ] Document remaining runtime/device blockers explicitly; do not claim release or native verification from web tests.
