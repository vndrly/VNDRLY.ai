# AskV TestFlight follow-up: wake warning, quiet audio and onboarding

September 7, 2026. Testing of iOS 1.0.1 build 157 reported a wake-unavailable
warning with AskV already open and Across VNDRLY off, barely audible spoken
responses at full volume, and missing onboarding write tools.

## Corrections

- Manual opening uses the conversation microphone directly when Across VNDRLY
  is off. It does not load the optional keyword model. When enabled, a failed
  keyword engine releases capture and restores conversation audio before the
  normal microphone takes over. Late errors from that discarded engine cannot
  stop the new conversation. A retained wake microphone still handles real
  interruptions after later wake activations.
- Disabling across-app listening stops idle capture immediately. Enabling it
  during a manual call closes the existing microphone before acquiring the
  shared wake/conversation source, retaining the saved conversation.
- Native audio configures both AVAudioSession and WebRTC's saved policy
  with a built-in-speaker default, preserving connected wired/Bluetooth routes.
  The earlier WebRTC policy could select the earpiece and overwrite the wake
  module's speaker configuration. Audio configuration/restoration is serialized
  with expo-av lifecycle work. Wake capture uses WebRTC's preferred hardware
  format; inference still receives resampled 16 kHz PCM.
- Realtime exposes the existing onboarding workflow from its screen or through
  `select_tool_pack`. Saved progress, field edits, step completion and final
  submission use the existing executor, role/organization permissions and
  canonical validation. Mutations retain saved-user confirmation and durable
  duplicate protection. Voice and typed mutation notices refresh onboarding
  views only for relevant successful changes.

## Validation and release boundary

Focused mobile regressions were observed failing before the fixes and passing
afterward. API tests cover tool visibility, authorization, confirmation,
mutation hints and real local PostgreSQL onboarding persistence. The configured
Realtime provider accepted the synthetic 20-tool onboarding schema (HTTP 200);
that check executed no onboarding actions and sent no customer records/audio.

The new native API requires iOS **1.0.2** with app-version runtime isolation.
Build 157 and runtime 1.0.1 OTA are the previous testing baseline, not evidence
that these fixes are installed. The release handoff must record the exact
commit, required suite results, web/API deployment, finished native build,
exact-build TestFlight submission and matching production OTA.

Native XCTest routing cases are included as an opt-in CocoaPods test spec.
They require Xcode and have not run on this Windows host. The release build
must compile the Objective-C++/Swift bridge. Physical acceptance must verify
audible speaker output, wired/Bluetooth transitions, real interruptions,
manual opening with wake off, opt-in wake, and onboarding completion using
designated test records. The screenshot alone does not identify the underlying
native keyword-engine error; optional wake hardware acceptance remains open.
