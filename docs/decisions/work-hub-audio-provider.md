# Work Hub audio provider decision

Status: approved release architecture as of September 11, 2026.

The foundation originally shipped with a disabled provider adapter. The approved implementation now uses browser/native WebRTC and a VNDRLY-managed coturn relay. The existing relay installer preserves established credentials and uses short-lived per-user relay credentials. No outside conferencing account is required for that transport.

The self-hosted speech-recognition trial did not meet real-time latency on the current VPS. The user therefore approved AssemblyAI for live meeting transcription rather than increasing server capacity. The provider key stays in GitHub Actions and the protected VPS environment, never in the repository or browser. The authenticated API boundary retains bounded input, sequencing, backpressure, attendee ownership and authorization checks.

The measured trial account supports five simultaneous live streams. The server defaults to that limit and returns a retryable busy response before opening a sixth provider connection; a bounded environment override can raise the limit only after upgraded-account capacity is measured. Native iOS meeting capture uses the dedicated meeting-only audio device and must still be proven by the exact cloud build and physical-device acceptance.

Capture follows the application's existing audio authorization. No separate provider-specific consent control is added to the meeting flow. Keep browser and iOS contract compatibility, tenant/participant authorization, removal enforcement, and private-message separation under regression tests. Relay allocation from outside the VPS and physical iPhone/headset behavior require their own evidence; a build or listener check alone is insufficient.

The approved synchronized replay trial, private Ask V retrieval, and published meeting summaries must each be verified before being called complete. See `docs/superpowers/specs/2026-09-09-work-hub-replay-trial.md`. This decision records scope and implementation boundaries, not a completed full ship.
