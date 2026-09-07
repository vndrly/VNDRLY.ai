# AskV iOS native build validation

The [September 7 testing follow-up](askv-testflight-snag-two.md) introduces new
native audio routing and runtime 1.0.2. Build 157 below is historical evidence;
the release handoff must independently verify the replacement build.

Date: September 6, 2026 (local; September 7 UTC). The original sections record build-only validation of baseline 156. The subsequently authorized full ship produced and submitted final build 157, recorded immediately below. Signing credentials were preserved.

## Final submitted build 157

The [full release workflow](https://github.com/vndrly/VNDRLY.ai/actions/runs/34081396462) completed successfully for exact source `95791e537f28f3547bfca643ffdbdc317206a705`. Its app code is identical to the fully verified `bd0538f` runtime checkpoint and includes the later audio batching, history and translation corrections.

- EAS build `1622ae9c-e3e9-48f2-89e6-34bf63d19eaf`: `FINISHED`, IOS, production/STORE, version/runtime 1.0.1, build 157, device build.
- Build created September 7 at 03:58:42.865 UTC and finished at 04:06:16.128 UTC.
- Exact submission `118b6e46-56b5-417e-92f1-e80bf392bb49`: `FINISHED`, no error. Terminal output confirmed successful App Store Connect upload at 04:09:29.262 UTC.
- [Signed final IPA](https://expo.dev/artifacts/eas/gpg2JLLYCsPnoODoZJSDTWE5ix6ZOQqXFSmkNObOe1U.ipa).
- Production iOS OTA group `d144c043-9426-4ff9-a1ab-1e0074befa3c` was published for runtime 1.0.1 from the same exact source, with successful independent production-channel readback.

Submission was verified by exact build/submission IDs, not a latest-build selector. No credential rotation or provisioning recreation was needed. Apple processing/tester availability and physical-device acceptance remain separate from successful upload.

## Reproducible source correction

The prior checkpoint `d04b7c02e80ad7b99240593281dc2cbde26f68ad` did not contain the native implementation even though it existed in the working directory. The mobile `.gitignore` used an unanchored `ios/` rule, which hid `modules/askv-wake/ios` as well as generated app native projects. The EAS archive also excluded the root `scripts` directory, including the preparation script invoked by the podspec.

Checkpoint `200ea71` corrects both boundaries:

- Anchor the generated-project ignores to `/ios/` and `/android/`.
- Track `AskVKeywordEngine.h`, `AskVKeywordEngine.mm`, `AskVWake.podspec`, and `AskVWakeModule.swift`.
- Include only `scripts/prepare-askv-ios.mjs` from root scripts in the EAS archive.
- Exclude generated `modules/askv-wake/ios/vendor` libraries so pod install downloads and verifies the pinned archive on the builder.

The existing local source was preserved; the files were newly tracked, not newly invented during this build check.

## Exact archive and module evidence

A detached full-repository worktree at `200ea71` was created at `C:/Users/JohnElerick/AppData/Local/Temp/vndrly-askv-ios-build-200ea71`. Existing local dependency directories were linked for configuration resolution only; those directories are excluded from the upload.

`eas build:inspect --platform ios --profile production --stage archive` exited 0. Its output is retained at `C:/Users/JohnElerick/AppData/Local/Temp/vndrly-askv-ios-archive-200ea71`.

Sixteen required archive files were checked against the isolated source using SHA-256: workspace manifests, shared AskV/API-client package inputs, preparation script, local module config, all four native source/podspec files, and all five model files. All were present and identical. Dependency folders, generated native vendor frameworks, environment credential paths, and store credential paths were absent.

Expo config resolved app version `1.0.1`, app-version runtime isolation, iOS bundle identifier `com.vndrly.field`, and the WebRTC plugin. Expo autolinking resolved package `askv-wake`, pod `AskVWake`, Swift module `AskVWake`, and Expo module `AskVWakeModule` from the isolated native source directory.

## Remote build

Direct installed EAS CLI 20.1.0 is used; the repository's TestFlight wrapper is intentionally not involved because it refreshes provisioning. Command:

```text
eas build --platform ios --profile production --non-interactive --freeze-credentials --wait --message "AskV 1.0.1 native compilation validation only, commit 200ea71"
```

Production profile: Node 22.14.0, pnpm 9.15.9, `sdk-54` macOS image, medium resource class, existing remote signing credentials, and version 1.0.1. EAS reserved build number 156 and reused the existing distribution certificate and active provisioning profile. EAS reported monthly included credits exhausted and account pay-as-you-go usage for the build.

Build ID: `1cfd7f1c-4e1c-49ce-9033-25b4e5fac9f7`. [Build page](https://expo.dev/accounts/vndrlyadmin/projects/vndrly-mobile/builds/1cfd7f1c-4e1c-49ce-9033-25b4e5fac9f7).

The remote record confirms `200ea71fd9f604b92682a05878d23dc0bb214ab9`, version 1.0.1, build 156, platform IOS, profile production, and STORE distribution. The 48.2 MB upload completed in 10 minutes 5 seconds. Cloud creation time: September 7, 2026, 02:14:54 UTC (September 6 locally).

Observed cloud stages:

- Dependency installation and Expo prebuild passed.
- 02:16:01 UTC: pinned sherpa-onnx iOS engine 1.12.29 prepared and verified on macOS for device and simulator.
- 02:16:11 UTC: `AskVWake (1.0.0)` pod installed.
- 02:16:52 UTC: CocoaPods completed with 118 dependencies / 132 installed pods.
- 02:17 UTC: Xcode/Fastlane archive started.
- 02:19:07 UTC: `AskVWakeModels.bundle` created.
- 02:20:55 UTC: AskV Swift compilation reached the audio-session code; only a deprecation warning was emitted.
- 02:21:00 UTC: `AskVKeywordEngine.mm` compiled and `libAskVWake.a` packaged.
- 02:21:17 UTC: the app binary linked.
- 02:21:34 UTC: app signed and `Archive Succeeded` recorded.
- 02:21:48 UTC: Fastlane confirmed the IPA exported and signed.
- 02:22:02 UTC: artifact upload finished.

Terminal status: **`FINISHED`, CLI exit 0**, independently confirmed by exact-ID `eas build:view`. Remote creation-to-completion time was 7 minutes 9 seconds; local build command to cloud completion was approximately 18 minutes, including the 10-minute source upload.

[Signed IPA artifact](https://expo.dev/artifacts/eas/NlaBf_PrdXfQGe6QLCsYy98auHBTCnPinvWCTQvkzzU.ipa).

No native compiler or linker fix was needed after correcting packaging. Non-fatal AskV warnings were the older `.allowBluetooth` option name (Apple recommends `.allowBluetoothHFP`) and mismatched parameter names in upstream C API documentation comments. The pinned upstream archive was not modified to silence warnings.

The isolated build predates parallel live-voice JavaScript fixes and the separate API test dependency patch. Its result must not be described as a build of those later changes.

## Remaining acceptance boundaries

This successful signed device build proves preparation, native dependency installation, JavaScript bundling, compilation/linking, signing and archive/export for the exact uploaded source. It does not prove real iOS microphone or audio routing behavior, or a simulator compile. Physical iPhone/iPad validation still must cover permissions, pre-roll, ongoing conversation, foreground changes, phone interruption, route changes, speaker/echo, wired/Bluetooth devices, and model accuracy in representative field noise. TestFlight submission is a separate release action and was not authorized here.

## Final source packaging verification

After the provider compatibility corrections, local EAS archive inspection at `bd0538fc7f1d4ed69fd4e6a359f1bdf87ddfa931` exited 0. The archive contains 863 files; all 43 selected required files matched the source SHA-256 exactly, including the Drizzle patch, lock/workspace manifests, final mobile client/session hook, English/Spanish translations, native sources, preparation script, model inputs, licenses and shared packages.

- Detached checkout: `C:/Users/JohnElerick/AppData/Local/Temp/vndrly-askv-ios-package-bd0538f`.
- Upload archive: `C:/Users/JohnElerick/AppData/Local/Temp/vndrly-askv-ios-archive-bd0538f`.
- Per-file manifest: `C:/Users/JohnElerick/AppData/Local/Temp/askv-ios-package-bd0538f-hashes.json`.
- Patch SHA-256: `96bbb4afefab511a6be03716400f1806e3ed34971020c8e57ca11928ef6b7fc2`.
- Lockfile SHA-256: `e708ec5a5ab272be2d6dc3449607df821c414466744b1cd2560e3662aa19cf5e`.

Current-source autolinking resolved the AskVWake pod/Swift module and AskVWakeModule. Cached preparation and its check both exited 0, verifying the pinned sherpa-onnx 1.12.29 device/simulator framework hashes. Real environment/credential/dependency/generated-vendor paths were absent from the upload archive; two example environment templates remain. No missing test-helper import exists in the actual included mobile build path. The detached checkout stayed clean.

This check performed no cloud build or submission. Build 156 remains the earlier `200ea71` compilation proof; the subsequently authorized full ship must build and submit the final release source.
