# AskV local iOS wake detector

This Expo local module was scaffolded with create-expo-module and implements
foreground, opt-in keyword spotting with sherpa-onnx v1.12.29. It requires a
new native iOS build; it is absent from Expo Go, Android, and older installations.

## Build inputs

- Run `pnpm --filter @workspace/vndrly-mobile prepare:askv:ios`, or let the local
  podspec run preparation during `pod install` / EAS prebuild.
- Run `pnpm --filter @workspace/vndrly-mobile check:askv:ios` to check the prepared
  device and simulator library hashes.
- The download is pinned to the upstream `sherpa-onnx-v1.12.29-ios-no-tts.tar.bz2`
  release and SHA-256
  `7c956e0d6261bb4d9e71eca425fdd32b7479933e20987beceead576577b2ee26`.
- Generated XCFrameworks live in ignored `ios/vendor`. They contain native code
  only. CocoaPods bundles `assets/askv-wake/{encoder,decoder,joiner}.onnx`,
  `tokens.txt`, and `keywords.txt` in `AskVWakeModels.bundle`.
- Preparation uses the system `tar` on macOS/Linux. Windows needs Python 3.12+
  because its system tar may lack bzip2; `ASKV_PYTHON` can specify the executable.
- The archive contains both `name.a` and `libname.a`. Preparation changes
  `LibraryPath`/`BinaryPath` to the lib-prefixed copies for CocoaPods' `-l` linker
  convention. It checks the original archive before making this packaging change.
- Upstream source/license: https://github.com/k2-fsa/sherpa-onnx/tree/v1.12.29
  (Apache-2.0). ONNX Runtime is MIT:
  https://github.com/microsoft/onnxruntime/tree/v1.17.1.
  The model license/provenance is beside the bundled model assets.

## JS contract

`requireOptionalNativeModule('AskVWake')` exposes:

- `configureConversationAudio(): Promise<void>` sets the built-in speaker as the
  default conversation output while preserving headset/Bluetooth routing. It
  configures both AVAudioSession and WebRTC's saved policy, without activating
  audio, starting capture, or loading the keyword model. Call after expo-av's
  conversation mode and before `getUserMedia` / peer creation. Both capture paths
  use WebRTC's same preferred hardware format; keyword PCM is still 16 kHz.
- `releaseConversationAudio(): Promise<void>` restores the previous WebRTC policy
  after closing the voice peer. The caller still restores expo-av's audio mode.
  Capture failure/stop does not restore this policy because a manual conversation
  may take over; module teardown does restore it.
- `start({ modelDirectory: '' }): Promise<void>` resolves once microphone capture
  starts. Empty directory selects the resource bundle; an absolute local path or
  a file URL selects an explicitly prepared local model directory.
- `stop(): Promise<void>` invalidates pending work and shuts down capture.
- `setDetectionEnabled(true): Promise<void>` resets the detector and discards
  old audio, then waits locally for another wake phrase.
- `setDetectionEnabled(false): Promise<void>` keeps the same microphone open and
  streams PCM for the active conversation.

Events:

- `onWake`: `{ keyword, samples, sampleRate: 16000 }`; samples contain up to two
  seconds of pre-roll including the detected phrase.
- `onAudio`: `{ samples, sampleRate: 16000 }`, float PCM in [-1, 1].
- `onError`: `{ code }`; no paths, audio, or model diagnostics.

Detection immediately switches into streaming mode before `onWake`, so the
wrapper must retain the pre-roll and subsequent audio during connection setup.
While waiting for the phrase, continuous microphone audio never crosses the
native bridge. No recording files are created.

`APP_INACTIVE`, `AUDIO_INTERRUPTED`, and `AUDIO_ROUTE_CHANGED` stop capture at the
native lifecycle boundary without waiting for JS. There is no native auto-resume.
The JS wrapper must remove subscriptions, invalidate its own async callbacks,
and request an explicit foreground restart after a stopped session. If the
system microphone permission dialog makes the app inactive, the pending native
start is cancelled. Requesting permission before starting capture gives the
wrapper an opportunity to handle the foreground transition cleanly.

Playback must keep the AVAudioSession compatible with `playAndRecord`; changing
it to a playback-only category can stop input. Permission prompts, model loading,
queued audio, and event delivery are generation-guarded so stop cannot reopen
capture later.

## Required iOS validation

The signed EAS iOS device build for source `200ea71` passed on September 6, 2026:
version 1.0.1, build 156, EAS `1cfd7f1c-4e1c-49ce-9033-25b4e5fac9f7`, terminal
`FINISHED` and CLI exit 0. Native preparation, pods, Swift/Objective-C++ compile,
linking, signing and IPA export succeeded. See
[`docs/askv-native-build-validation.md`](../../../../docs/askv-native-build-validation.md)
for the exact source/artifact evidence and limits. No TestFlight submission occurred.

Apple audio hardware cannot be exercised locally on Windows. Before shipping,
complete the remaining macOS/iOS validation:

1. Build the iOS simulator target (device compile/prebuild/pods passed as above),
   and build the final release snapshot after later application changes.
2. Fresh-install permission approval/denial and stopping during the prompt.
3. Exact phrase detection, room-noise false wakes, accent/distance, and speaker
   echo while playing the answer. Initial thresholds are score 1.0, probability
   0.25, one trailing blank; tune only with measured device evidence.
4. One microphone for idle detection, connection setup and spoken conversation;
   verify initial words survive the pre-roll handoff.
5. Background/inactive, phone-call interruption, route change, logout, disabling
   wake mode, and module teardown all stop the microphone immediately.
6. Background or stop during model initialization cannot start capture afterward.

The preparation checks prove the pinned library inputs and packaging. They do
not substitute for a native compilation or device microphone validation.

The `AudioRoutingTests` CocoaPods test spec exercises the real AVAudioSession /
WebRTC policy without starting capture: speaker defaults surviving WebRTC
configuration, stable hardware preferences, idempotent release, and preserving
a newer owner's policy. Run this iOS XCTest spec on macOS with Xcode. Physical
device checks must also cover full-volume built-in-speaker playback and routing
to/from wired headphones and Bluetooth; a simulator cannot prove audibility.
