# AskV keyword model

Source: [sherpa-onnx KWS Gigaspeech 3.3M standard model](https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2).

The upstream README declares Apache License 2.0; see LICENSE.txt.
Archive SHA-256:
`f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a`.

`encoder.onnx` and `joiner.onnx` are the int8 models from that archive.
`decoder.onnx` is its floating-point decoder; `tokens.txt` is unchanged.
`keywords.txt` contains the SentencePiece tokens for “ASK V” with label ASKV.

The standard archive is intentional: the separate fixed-shape `-mobile`
encoder failed actual inference. This standard model passed nine real WASM
inference cases. The model files are identical in the web and iOS bundles.
Full hashes and verification details are in docs/askv-local-wake-assets.md.
