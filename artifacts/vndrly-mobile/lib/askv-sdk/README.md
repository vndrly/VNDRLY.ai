# AskV voice integration

AskV uses the published OpenAI Agents Realtime SDK, pinned to 0.22.0.
Native microphone input and speaker output travel directly over WebRTC. The SDK
owns speech turn detection, responses, interruption, function execution and history.

The native transport and its lifecycle tests are adopted from
[OpenAI's React Native example](https://github.com/openai/openai-agents-js/tree/90a6b529a048981cf61224a32bda92a9525a18e2/examples/realtime-react-native)
at commit `90a6b529a048981cf61224a32bda92a9525a18e2`, under the accompanying MIT license.
The transport adaptation accepts an already-open microphone stream, so native
capture and the ephemeral-key request can begin together. The transport still owns
closing that stream. The SDK import goes through a workspace package that supplies
its required Zod peer. The provider also closes capture on cancellation before connect.

The browser preview uses the SDK's built-in WebRTC transport. Native code does not
register browser globals or feed PCM through the old wake/HTTP chat/TTS pipeline.
The SDK's Zod 4 dependency is isolated in that workspace package; VNDRLY's shared Zod stays unchanged.

Speaker routing reproduces the upstream example's documented defaultToSpeaker
configuration in an Expo config plugin. This preserves headset/Bluetooth options,
and needs a new native build. No per-turn audio-session reconfiguration is added.

## VNDRLY adapter

- Explicit Start opens the microphone while the server mints an ephemeral key.
  Page load, screen focus, saved Across VNDRLY preferences and foregrounding do not start capture.
- The token route requires signed-in authentication. It performs no history,
  onboarding, greeting, preference, documentation or capability database lookup.
- Natural replies are generated as native Realtime audio. No application chat
  request, local speech synthesis, logging or transcript save precedes the reply.
- Conversation persistence runs separately after transcript events. Protected
  mutations retain role/company authorization, confirmation and idempotency.
  Approval uses the SDK's current user transcript directly; no transcript-save
  prerequisite, speech polling loop or voice-only action allowlist is retained.
  The old read/update shadow Gate-task tools are omitted; the actual Gate lookup,
  form preparation, check-in and check-out operations remain available.
- The standard microphone coordinator stops any other actual capture owner.
- Stop, logout, organization switches, backgrounding and transport failure close capture.
- Every session end is reported to `/api/assistant/voice/metrics` with its cause (the drop log).
  A session that dies on its own (connection lost, voice service error, or a microphone that
  stops sending audio while the connection stays up) reconnects once; a second failure within
  30 seconds shows the error instead. A spoken request with no answer after 60 seconds is
  cancelled so later requests are not held behind it. None of this is verified on a physical iPhone yet.
- Pause keeps the session and microphone open but treats everything heard as background: nothing
  fills the Gate form or reaches the assistant. It starts from the Pause button, a spoken "pause" /
  "hold on" / "wait" (`lib/askv-voice-pause.ts`), or by itself when an open check-in gets nothing
  said or typed for 30 seconds. "Hey V", "Ask V", "V", "continue", "resume", "let's finish the
  check-in", a Gate "check in" / "check out" command, or the Resume button end it, and V says where
  the check-in stands. A reconnect keeps the pause and the check-in's place. Stop V ends the pause.
- The same live SDK session stays available across screens when Across VNDRLY is on.
  There is no separate keyword model or five-minute wake-idle handoff in this voice path.

The upstream example currently uses newer Expo/React Native versions than VNDRLY.
This integration keeps VNDRLY's versions and existing WebRTC dependency; Metro
export, TypeScript, device-build and physical-device results must be recorded separately.
Mocked tests and browser speech fixtures do not verify iPhone microphone hardware.

## Selection evidence

The authenticated VNDRLY web app uses this same workspace SDK and its built-in
`OpenAIRealtimeWebRTC` transport. Its former custom voice transport is removed.
Both clients pass current in-memory Next Steps, focused-control and Gate draft
snapshots to the SDK. Context changes update the live agent without an additional
request or reconnection. Tool results reconnect existing workflow offers, saved
setup progress, navigation, form preparation and canonical data refreshes.

Selected external calendars and saved task recovery use their existing server
authorization at tool invocation. Private personal connection turns are not
saved to company transcripts or allowed to write company records. Switching that
context starts a fresh SDK history. These protected reads never gate capture,
connection, ordinary conversation or unrelated reads.

| Public integration | Evidence and fit |
| --- | --- |
| [OpenAI Agents JS](https://github.com/openai/openai-agents-js) | Official published SDK, MIT, native example using the same WebRTC library, lifecycle tests, React Native package shims. Selected. |
| [LiveKit React Native](https://github.com/livekit/client-sdk-react-native) and [Agents](https://github.com/livekit/agents) | Established native/Expo framework; adds LiveKit infrastructure and another native WebRTC package for this app. |
| [Pipecat React Native transports](https://github.com/pipecat-ai/pipecat-client-react-native-transports) | Native implementation; adds bot infrastructure and a Daily WebRTC fork. |
| [Switchboard OpenAI toolkit](https://github.com/switchboard-sdk/openai-realtime-toolkit) | Native audio toolkit; adds vendor framework/account and local audio models. Less direct fit. |
| [Expo WebRTC OpenAI demo](https://github.com/thorwebdev/expo-webrtc-openai-realtime) | Relevant Expo example; less maintained integration/package evidence than the official SDK. |

The selected upstream commit's [CI](https://github.com/openai/openai-agents-js/actions/runs/44109079280)
and [release](https://github.com/openai/openai-agents-js/actions/runs/44110939217) passed.
This establishes those runs, not a perfect integration success rate or guaranteed
zero latency. None of these repositories proves performance on John's iPhone.
