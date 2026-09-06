# Local AskV wake assets

The browser worker and iOS module use the English sherpa-onnx KWS Zipformer
Gigaspeech 3.3M model. Inference runs locally. These build assets do not include
any user recording or hosted speech-recognition endpoint.

## Pinned sources

- Model: `sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2`
  from [the upstream KWS release](https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2).
  Archive SHA-256: `f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a`.
- Browser runtime: `@siteed/sherpa-onnx.rn@1.3.1`, containing sherpa-onnx 1.13.0.
  The shipped runtime files are copied from that package's WASM distribution.
- iOS runtime: sherpa-onnx 1.12.29 and ONNX Runtime 1.17.1 from the upstream
  `sherpa-onnx-v1.12.29-ios-no-tts.tar.bz2` archive. The pinned downloader,
  checksum and CocoaPods packaging are documented in the local module README.

The encoder and joiner use the archive's int8 variants. The decoder uses its
floating-point variant. Their shipped names are `encoder.onnx`, `decoder.onnx`,
and `joiner.onnx`. The five inference files, including `tokens.txt` and
`keywords.txt`, are identical in the web and mobile asset directories.

Use the standard archive named above. The separate `-mobile` archive's static
encoder reshapes failed actual inference (17 frames produced, 16 requested).
The standard model passed the shipped worker's real inference checks without
changing thresholds.

`artifacts/vndrly/public/askv-wake/manifest.json` pins the individual runtime
and model files. `keywords.txt` is the SentencePiece tokenization of “ASK V”:
`▁AS K ▁ V @ASKV`. The output label is exactly `ASKV`; “V” alone is not a
configured wake phrase.

## Reproducible inference check

Run `node scripts/verify-askv-wake.mjs`. It:

1. Verifies all pinned runtime and model hashes and web/mobile model parity.
2. Executes the exact shipped worker, real WASM binary and real ONNX weights
   in a Node VM providing worker-like browser globals and local-only asset reads.
3. Decodes committed 16 kHz PCM WAV fixtures synthesized offline using Windows
   System.Speech. Both David and Zira are tested for “Ask V,” “Ask V, show me my
   tickets,” “V” alone, and unrelated speech. Five seconds of silence is also
   checked.
4. Requires exactly one `ASKV` event for each positive case and no event for
   all negative cases. It also verifies consumed PCM is overwritten in memory.

All nine cases passed with score 1.0, probability threshold 0.25, and one trailing
blank. Fixtures can be regenerated on Windows with
`node scripts/verify-askv-wake.mjs --generate-fixtures`; no external voice
service or microphone is used.

This checks real inference and worker bootstrapping. It does not establish
real-microphone accuracy, browser audio capture behavior, iOS compilation, or
performance on a phone. Device checks must cover accent/noise/distance, false
wakes, echo, permission and foreground transitions, and the shared-microphone
handoff before a native release.

The separate `scripts/verify-askv-browser.mjs` test also passed in real headless
Edge against the local Vite server. It feeds the synthetic Ask V request WAV as
the browser microphone, executes the shipped AudioWorklet and worker/model,
asserts one capture stream and one wake handoff with buffered/live PCM, verifies
ended microphone tracks, and rejects any API or off-origin network request.
Start Vite on port 5193, then run `node scripts/verify-askv-browser.mjs`.
`ASKV_TEST_ORIGIN` and `ASKV_BROWSER_PATH` can select another local server/browser.
This adds browser-engine evidence; it does not replace physical microphone or
iOS acceptance testing.

## Licenses

The model's upstream README declares Apache License 2.0. Its license and
provenance accompany both bundled model copies. Runtime redistribution notices
are retained beside the native module; the browser runtime's source package
is MIT, sherpa-onnx is Apache-2.0, and ONNX Runtime is MIT.
