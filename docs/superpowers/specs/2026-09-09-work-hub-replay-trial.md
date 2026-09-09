# Work Hub meeting replay trial

Date: 2026-09-09

Status: product scope approved in voice conversation; implementation and trial acceptance outstanding. This document is not release evidence.

## Approved experience

Provide a real recorded meeting trial, not a static mockup. An authorized person who missed a meeting should be able to replay its shared experience from start to finish: original audio, messages, files and photos, Ask V answers, speaker indicators, elapsed time, and the approved meeting appearance at their original relative times.

The replay is read-only and visibly labeled as a replay. It must not rejoin a room, activate the viewer's microphone, re-run Ask V answers, resend messages, or replay a destructive command. The meeting layout remains responsive; this is the shared meeting experience, not a recording of one attendee's personal desktop, scroll position, or private messages.

The host or an authorized administrator can assign the replay as required or optional to someone allowed to access that meeting. Assignment does not bypass meeting or organization access checks. Playback progress is resumable and presented as Not started, In progress, or Completed. Seeking to the end does not establish completion: progress represents distinct portions actually played. Playback completion is not evidence of attention or comprehension.

## Privacy and recording

Recording needs a clear notice and consent state covering retained audio and replay, not an assumption that transcription consent also permits recording. Capture is stopped or paused when the required consent is absent or withdrawn. Pauses, upload failures, and missing audio must be visible as gaps; an incomplete recording must not be called a complete second-for-second replay.

Private side messages, private file attachments, private activity indicators, and private Ask V results never enter the shared replay. They remain independently accessible only to their two authorized participants. The replay and its file/audio downloads require server-side authorization.

## Storage decisions deliberately deferred

The user wants to experience the trial before choosing long-term storage policy. No 30-day cutoff has been approved. Do not introduce automatic deletion, cold-storage movement, a download deadline, billing, a paid plan, or an external recording service as part of this decision.

Measure the trial's actual audio, event, and attachment storage separately, count unique stored files rather than duplicating them for every replay, and report total bytes and meeting duration. Report actual available capacity only if independently verified. Production-wide recording is not automatically enabled by approving a trial; capacity failures must be explicit and must preserve existing records.

## Implementation direction to validate

Prefer recording consented meeting audio plus timestamped shared events, replayed through the approved meeting UI, rather than capturing participants' desktops. Preserve the appearance/version needed by the replay so future UI changes do not silently alter the recorded meeting. The audio clock should drive event presentation; browser timers alone are not an accurate recording clock.

The existing code contains live audio, transcript timestamps, shared file records, and consent checks. It does not yet contain a complete audio recording pipeline, durable history of transient meeting visuals, a replay player, or assignment/playback-completion services. All are required work, not completed capabilities.

Browser support exists for recording media streams and observing played time ranges; neither alone provides a trustworthy server-side completion ledger or an entire replay implementation. References: [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder), [played time ranges](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/played).

## Acceptance checklist

- [ ] Record and replay an actual consented test meeting using the approved UI.
- [ ] Verify synchronization of audio, speaker changes, typed messages, photos/files, and Ask V answers across the full meeting.
- [ ] Verify pause/resume, seeking, reconnects, recorder interruption, and clearly reported gaps.
- [ ] Verify assignments and resume progress for an authorized absent attendee.
- [ ] Verify seeking to the end and repeatedly playing the same interval cannot produce false completion.
- [ ] Verify private side content and cross-organization content never leak into shared replay, search, downloads, or reports.
- [ ] Verify revoked access and recording-consent changes server-side.
- [ ] Verify keyboard, mobile, and screen-reader use and supported playback formats on target devices.
- [ ] Report actual stored bytes and duration from the trial, without making retention or billing decisions.
- [ ] Show the working trial to the user before claiming replay acceptance.

This trial is an addition to the active Work Hub release work. Microsoft 365 remains separately paused; no earlier unfinished release track is removed by this addition.
