# AskV live voice validation

Date: September 6, 2026. No deployment, push, OTA, or TestFlight submission was performed by this validation.

The production web Realtime client and production server session builder completed
real OpenAI WebRTC audio conversations using synthetic Windows speech. The bundled
local wake engine also handed its existing microphone and buffered utterance into
a real conversation. This test discovered and fixed an audio packet flood that
the previous mocked transport tests could not reveal.

## Test boundary

`scripts/verify-askv-live-voice.mjs` imports the actual
`artifacts/api-server/src/assistant/realtime-session.ts` and serves the actual web
client through a temporary Vite server bound to `127.0.0.1`. Its broker requires a
random per-run header and matching origin, permits at most two calls, and uses the
existing server OpenAI credential. The provider session uses the production model
default `gpt-realtime-2.1`, voice `marin`, transcription configuration, and server
VAD with automatic responses and interruption enabled.

Edge runs with an explicitly synthetic microphone WAV. The wake scenario uses the
shipped AudioWorklet, worker, WASM, models, ring buffers, resampler, and client.
The fixture says “Ask V, show me my tickets.” No ticket data is supplied. The test
provides a short synthetic-only instruction and an empty tool list, so no domain
action can run. Follow-up text and counting requests are also synthetic.

The verifier prints only counters, timings, connection states and allowlisted
error categories. It does not print or save keys, ephemeral credentials, SDP,
transcripts, or provider audio. It records incoming RTP byte and audio-energy
counters to distinguish actual audio reception from a transcript-only response.
Temporary servers, browsers, microphone tracks, and fixture copies are closed or
removed after the run. There are no database imports or database operations.

## Observed provider results

The normal microphone conversation passed in 33.7 seconds:

- The actual session configuration was accepted and the opening greeting played.
- Server VAD recognized the synthetic spoken ticket request and replied
  automatically; no manual response trigger was sent for that voice turn.
- A typed follow-up received a voiced response on the same peer connection.
- Explicit interruption produced `output_audio_buffer.cleared` and a cancelled
  response. A subsequent typed turn received another voiced reply.
- Five playback starts and five playback stops/clears were observed, with
  135,858 incoming audio bytes and nonzero RTP audio energy.
- One microphone and one peer connection were used. Closing stopped the
  microphone, closed the peer, and detached/paused the playback element.
- Zero client errors and zero domain tool calls occurred.

After the packet fix, the final local-wake scenario passed in 67.2 seconds:

- One local wake, one microphone, and one peer connection; no broker request
  occurred before the wake callback.
- 43,051 original 16 kHz samples were retained through wake/connection and
  delivered first. The provider transcript recognized the ticket request.
- The provider answered automatically. While a later counting response played,
  the second real synthetic-microphone utterance caused both
  `input_audio_buffer.speech_started` and `output_audio_buffer.cleared` at the same
  observed timestamp (21.254 seconds). An automatic voiced reply followed.
- Two speech starts/stops and three playback starts/stops/clears were observed.
  Incoming audio totaled 266,578 bytes, with nonzero RTP audio energy.
- Forty additional seconds of continuous capture/listening remained connected.
  The peak browser send queue was 669,889 bytes, below the unchanged 1 MiB cutoff.
  The final observed queue was 153,720 bytes after draining from an earlier peak.
- There were 1,316 audio appends, zero client errors, and zero domain tool calls.
  Closing stopped the transferred microphone and closed the peer.

The only provider error events were `response_cancel_not_active`, produced by
the client's idempotent cancel-before-typing behavior when no response was active.
Both clients already handle that event without failing the conversation.

These are observations from these runs, not a production latency or recognition
accuracy benchmark.

## Defect found and correction

The browser AudioWorklet can deliver approximately 375 tiny frames per second.
The old client sent one Realtime `input_audio_buffer.append` per frame. The live
wake test reproduced 5,159 messages and 1,048,686 queued bytes, followed by the
client's “connection is too slow for voice” shutdown. Some runs failed before
the first response; others failed immediately afterward.

Web and mobile clients now accumulate resampled PCM into 1,200-sample packets:
**50 milliseconds at 24 kHz**, or at most 20 messages per second during continuous
capture. This bounds packet overhead while adding less than 50 milliseconds of
packetization delay. Buffered pre-roll is transmitted in order using the same
packet size. The existing 1 MiB overload protection remains enabled. Partial
packets are cleared on close, and ongoing silence completes packets naturally;
closing or muting never flushes additional microphone audio after shutdown.

Focused regressions were observed failing before the correction (400 messages
for the small web-frame case; 105 for the mobile case), then passing afterward.
They decode the emitted PCM to verify exactly 24,000 ordered samples across
pre-roll/live boundaries and an output interruption, and verify that no partial
or later frame is sent after close. The full targeted transport files passed:
web **9 tests**, mobile **8 tests**. Mobile uses the same 50 ms batching, but this
does not represent a physical iOS audio test.

Both affected application TypeScript checks also passed after the correction.
The verifier passed Node's syntax check, and the four changed transport/test
files passed Git's whitespace/error check.

## Final integration regressions

After the transport correction and local database-test infrastructure changes,
the non-database integration gates passed on the current worktree:

| Gate | Result |
| --- | --- |
| Shared-library suites | 53 tests across 6 packages; zero failures |
| Full web suite | 120 files; 873 passed, 3 existing skipped; 139.85 seconds |
| Full mobile suite | 97 files; 645 passed; 112.48 seconds |
| Locale parity | Mobile 1,745 English/Spanish keys; web 4,294 English/Spanish keys |
| Production web build | Final translated tree passed in 20.46 seconds |
| Workspace typecheck | Libraries plus API, desktop, mockup sandbox, commercial app, and scripts passed; unchanged web/mobile checks reused |

Web and mobile ran their complete test catalogs with three workers each while
the separate API/database work proceeded. The build retained non-fatal
sourcemap-location and chunk-size warnings. No paid provider scenario was
repeated for these integration gates.

The first root library-script invocation encountered the local system's pnpm 11
instead of the repository's pinned pnpm 9.15.9. Running the equivalent recursive
gate explicitly through Corepack passed. A validation-only ignored PATH shim
now routes nested pnpm invocations through Corepack without changing the
repository's package-manager version.

After the full API gate identified five missing AskV error translations, the
final English/Spanish updates passed the focused web locale/API-error suite
(5 files, 100 tests), the equivalent mobile suite (6 files, 106 tests), and
standalone locale parity at the counts above. The complete web/mobile suites and
paid provider scenarios were not repeated for this translation-only update.
The production web bundle was rebuilt successfully after these final translations.

Full command logs are retained locally under
`%LOCALAPPDATA%/Temp/askv-final-gates-20260906/`.

## Reproduce

Run from the repository root with its existing dependencies and server credential
configuration. This is an explicit live-provider test and incurs normal provider
usage; it is not part of the ordinary offline test suite.

```powershell
$env:ASKV_LIVE_VOICE_TEST = '1'
$env:ASKV_BROWSER_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node scripts/verify-askv-live-voice.mjs
```

Use `--wake-only` to rerun only the real wake/handoff/barge-in/sustained-listening
scenario. Omitting `ASKV_BROWSER_PATH` uses Playwright's installed Edge channel.
The generated microphone files contain only the committed synthetic fixture and
silence. The verifier never opens the physical microphone.

## Remaining acceptance boundaries

This loopback test deliberately replaces the HTTP authentication/database broker
with a narrowly authenticated local adapter around the production session
builder. It therefore does **not** establish login/session authorization, daily
greeting claims, database transcript persistence, navigation/context updates,
or tool execution through the full application. Those require the separately
isolated application/database integration gates.

The 40-second listening hold is not the five-minute session-owner idle test.
Physical iPhone/iPad audio routing, Bluetooth, interruptions, background/lock,
microphone permissions/revocation, realistic noise/accents/plates, and field
acceptance remain separate checks. The later mobile JavaScript batching change
must also be distinguished from any native build started at an earlier commit.

Protocol reference: [OpenAI Realtime WebRTC guide](https://developers.openai.com/api/docs/guides/realtime-webrtc)
and [Realtime call creation](https://developers.openai.com/api/reference/typescript/resources/realtime/subresources/calls/methods/create).
