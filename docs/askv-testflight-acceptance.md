# AskV internal TestFlight acceptance

Status: pending. This checklist is a test record, not evidence that physical-device acceptance has passed.

## Before submission

- Use the final verified source checkpoint and matching web/API changes. Build 156 at `200ea71` is an older native compilation baseline and must not be submitted as the final implementation.
- Under the release command, apply the guarded additive greeting migration, configure the internal `ASKV_NATURAL_VOICE_USER_IDS` pilot, and produce/submit the final iOS binary using existing signing credentials.
- Record the source commit, API deployment, app version/build, device/iOS version and tester. Keep the Gate fallback available through acceptance.

## On the internal TestFlight build

For every row, record Pass/Fail, device/build and any reproduction notes. Use designated pilot accounts and test records for field workflow actions.

| Scenario | Expected result |
| --- | --- |
| Open AskV with microphone permission already granted | One tap opens the panel, gives the appropriate greeting and listens. A spoken question receives a spoken answer without transcript approval or Send. |
| First use and permission denial/revocation | The OS permission prompt is handled clearly. Denial or later revocation leaves typing available and no stuck listening indicator. Re-enabling permission allows recovery. |
| Same-day greeting across web and iOS | Only the first full greeting claim for the user's local day wins; later opens use the shorter greeting. |
| Follow-up and interruption | Several spoken turns remain in one conversation. Speaking during an answer stops that answer and responds to the new turn without duplicate replies or self-triggered echo. |
| Mix typing and voice | A typed question joins the same history and receives the appropriate response. It does not start a second microphone or conversation. |
| Mute and reopen | Mute stops capture and spoken output. Typing remains usable. Reopening/restarting preserves mute until explicitly unmuted. |
| Restore conversation | Saved voice and typed messages remain in order without duplicates. Unmuting resumes with the prior context available. |
| Foreground local wake | Enable wake explicitly. “Ask V” activates; “V” alone and unrelated speech do not. The question spoken immediately after the wake phrase is preserved. Disabling wake stops its capture. |
| Navigate with an active conversation | Route/record context follows navigation without duplicate sessions. Returning from Gate/PTT leaves only the intended microphone owner active. |
| Five-minute idle | Wait five minutes after playback actually stops, with no further user input. The session closes. A new accepted turn before expiry restarts the idle interval. A long spoken answer is not cut off by the idle timer. |
| Audio routes | Repeat a conversation on the device speaker, wired audio and Bluetooth; switch routes during a session and confirm recovery and intelligible audio. |
| Interruptions and foreground | Test a phone interruption, screen lock and background/foreground transition. Capture stops where required, does not continue unexpectedly, and recovers through the intended interaction. |
| Connectivity loss | Slow/offline/reconnected conditions show a recoverable state. Failed transcript saves recover without duplicate history, and an uncertain action is never blindly repeated. |
| Identity and organization change | Logout or membership/account switching stops the old session and capture; the next session uses only the newly selected permissions/context. |
| Gate and field actions | Check-in/out and lifecycle actions follow the existing permissions, site/GPS rules and status transitions. A mutation occurs only after a real user confirmation of the pending summary and executes once. Cancellation/correction performs no unintended action. |
| Existing drafts | Photo, parts, labor, mileage and safety requests open the real entry/review surfaces. Drafts require the existing reviewed submission; no readings or values are invented. |
| Representative field audio | Use real names, plates, accents and noisy gate/truck conditions. Record missed/false wakes, recognition corrections, latency, fallbacks and any duplicate behavior. |

## Wider rollout decision

Resolve failed cases and retain their reproduction notes. Record the pilot's latency, fallback, duplicate and cost observations; cost metrics are estimates rather than provider billing. Keep the legacy Gate path until field parity is demonstrated. Android and background/locked-screen wake are outside this approved foreground iOS/web scope.

Evidence already completed is in [the reconciliation report](askv-reconciliation-report.md), [authenticated live validation](askv-authenticated-live-validation.md), [native compilation](askv-native-build-validation.md) and [automated validation](askv-validation-evidence.md).
