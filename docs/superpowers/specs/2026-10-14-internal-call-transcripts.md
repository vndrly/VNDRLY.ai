# Internal vendor call transcripts

## Agreed behavior
Internal vendor calls can show a live text card and retain a searchable, speaker-labeled transcript in call history. Company administrators control the policy. No approval dialog is shown at either end of each call. A persistent Transcription on / paused indicator is visible. Audio and derived text remain within VNDRLY; no AssemblyAI, OpenAI, Anthropic, browser speech service, or other remote transcription fallback is used.

## Existing boundary and necessary change
Calls already use the meeting audio service and authenticated native PCM frames. However, calls currently set recordingAllowed=false, the native streaming endpoint connects to AssemblyAI, and the company-policy helper is not wired to call capture. This requires an internal streaming adapter and company-policy integration rather than merely displaying a card.

## Proposed implementation
- Reuse native 16 kHz mono PCM frames and their existing device lease, sequence, membership, and active-call checks.
- Add a VNDRLY-hosted streaming adapter to the existing native speech engine (FFmpeg plus local Whisper model). Process bounded rolling chunks, publish final text with server timestamps and authenticated speaker identity, and flush the final short chunk when a call ends.
- Persist a vendor-specific administrator-controlled policy, its version, verifier, and effective date. Policies do not carry across vendor contexts. Restrict capture to calls whose participants currently belong to that vendor; calls involving an external contact do not inherit the policy.
- Onboarding displays the company communication policy once. Call start uses the verified company policy without manufacturing employee-consent rows or prompting on every call. OS microphone permission remains the ordinary call requirement.
- Store transcript segments using the existing meeting transcript records; read them through a call-specific vendor authorization check. Participants can read their own call records; vendor administrators can read the vendor records their company permissions authorize. No cross-vendor read or automatic external sharing.
- Add the live/saved transcript card to Calls with speaker labels, timestamps, search, and selectable text. Mark speech recognition as an estimate. Corrections preserve the original and an audit trail.
- Stop capture on call end, sign-out, organization change, revoked membership, or loss of the authorized audio lease. A speech-service error pauses transcription and preserves the voice call.

## Runtime readiness
Confirm that the VNDRLY server has the configured local decoder, speech binary, and model. Configure bounded concurrency and queues; report service unavailable honestly if any are absent. Never substitute a third-party provider. Native streaming and two-device behavior need verification before a live-release claim.

## Validation
Test internal versus external calls, vendor/admin access, account and device changes, duplicate or missing audio frames, speaker identity, tail flush, service failure without dropped calls, and saved transcript readback. Use isolated test data. Review both iPhone and iPad layout. No database reset or credential change is required.

## Approval boundary
This document is the concrete design for the new internal processing integration. No transcription engine or company-wide policy has been enabled by the screenshot or Calls layout work.

## Call history and voicemail behavior
- Recent calls expose View transcript only when a saved transcript exists.
- Missed calls retain their existing details and callback behavior.
- Voicemail is automatically transcribed by the internal engine after upload, with readable text beside playback and no manual Transcribe action.
- Processing, unavailable, and failed states remain visible; audio playback continues independently. Retry is bounded and does not duplicate transcript records.
