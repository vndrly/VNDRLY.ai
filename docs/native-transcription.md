# VNDRLY native meeting transcription

Meeting audio is decoded and transcribed on VNDRLY's Ubuntu VPS. The meeting route has no external speech service or fallback. Provisioning downloads only public source code and model weights; the smoke test uses the public JFK sample included in whisper.cpp. The existing assistant speech provider is a separate path and is not used by meeting capture.

## Pinned assets

The engine uses the upstream [whisper.cpp v1.8.3 release](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.8.3), pinned to commit `2eeeba56e9edd762b4b38467bab96c2517163158`. This is an explicit reproducible version, not a claim that it is the latest release. Its CLI supports the CPU/thread/output options used below. [Pinned CLI source](https://github.com/ggml-org/whisper.cpp/blob/2eeeba56e9edd762b4b38467bab96c2517163158/examples/cli/cli.cpp).

| Asset | Immutable origin | SHA-256 |
| --- | --- | --- |
| Source archive | [Official GitHub archive](https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/2eeeba56e9edd762b4b38467bab96c2517163158) | `089b898aa83b24a8321e0fd554eeb0967fb03dd687e27f6374c72d3363b5b429` |
| Multilingual base model, 147,951,465 bytes | [Official model repository at commit 5359861](https://huggingface.co/ggerganov/whisper.cpp/blob/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.bin) | `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe` |
| Public 11-second sample | [Pinned samples/jfk.wav](https://raw.githubusercontent.com/ggml-org/whisper.cpp/2eeeba56e9edd762b4b38467bab96c2517163158/samples/jfk.wav) | `59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e` |

The source archive and sample were downloaded and hashed during implementation on 2026-09-09. The model hash and byte count were verified against the official repository's LFS metadata; the provisioner verifies downloaded model bytes before any use. No moving `main` model URL is used.

FFmpeg comes from Ubuntu's authenticated package repositories. Its installed version is recorded in each readiness report. This allows Ubuntu security updates rather than pinning an obsolete system-package build.

## Provisioning and activation

From the reviewed deployment checkout, run:

```sh
sudo bash scripts/provision-native-transcription.sh
```

The script requires the existing non-root `vndrly` account and regular `/var/www/vndrly/.env.production`. It preserves unrelated environment settings and file ownership/mode, refuses ambiguous keys or custom speech paths, and uses a lock to prevent concurrent provisioning. It changes no database, credentials, web configuration, firewall, or running service.

Provisioning first sets `VNDRLY_NATIVE_TRANSCRIBE_ENABLED=0` for the next API restart. Installation needs at least one CPU, 1 GiB available memory, 2 GiB free space on `/opt`, and initial one-minute load no higher than half the CPU count. These limits admit installation and measurement only. Compilation uses one job so the existing API retains memory headroom.

The root-owned installation paths are:

```text
/opt/vndrly-speech/whisper-v1.8.3-2eeeba56/bin/whisper-cli
/opt/vndrly-speech/whisper-v1.8.3-2eeeba56/jfk.wav
/opt/vndrly-speech/models/ggml-base-60ed5bc3dd14.bin
/usr/bin/ffmpeg
```

The engine is built with static whisper/ggml libraries and CPU instructions selected for this VPS; do not copy that executable to a different CPU. Binaries are mode 0555, models and manifests are 0444, and installation directories are root-owned and not writable by the application account. Existing assets are verified and reused; mismatches are preserved for inspection and cause failure. No broad recursive cleanup is performed. Source/build and public smoke-test directories remain under `/opt/vndrly-speech` for inspection.

Two public sample transcriptions run concurrently as `vndrly`, each with two threads, one whisper processor, CPU inference, and automatic language selection. The production API must independently enforce its global two-job limit and two-thread limit. Each sample must contain the expected JFK phrase and complete within **8.8 seconds**, leaving 20% timing headroom for the eleven-second recording. The larger observed resident memory figure, doubled, must leave at least **512 MiB** of the pre-test available memory for the app. Fresh available memory and free disk are checked again afterward. Post-build CPU capacity comes from the concurrent benchmark; load average would still contain the script's completed compilation work.

Only after all checks pass does the script atomically enable these settings:

```text
VNDRLY_NATIVE_TRANSCRIBE_ENABLED=1
VNDRLY_WHISPER_BIN=/opt/vndrly-speech/whisper-v1.8.3-2eeeba56/bin/whisper-cli
VNDRLY_WHISPER_MODEL=/opt/vndrly-speech/models/ggml-base-60ed5bc3dd14.bin
VNDRLY_FFMPEG_BIN=/usr/bin/ffmpeg
```

A root-owned `readiness.*` report records the pins, FFmpeg version, concurrent elapsed times, peak RSS, CPU count, load, and available memory/disk. The script prints its exact path. It does not restart the API; the deployment workflow must check its exit status before continuing and then verify authenticated meeting capture after restart. Changing the file does not change environment values already loaded by an existing API process.

## Failure and readiness limits

A one-core VPS is permitted to install and benchmark. It is **not** assumed able to serve concurrent live speech. If either timed sample, resource check, download checksum, or compilation fails, the script exits nonzero and the next API start remains disabled. Do not relax the admission thresholds or substitute another model to declare readiness. Review the printed public-sample evidence and address the demonstrated capacity or installation problem. Changing hosting capacity requires the user's direction.

Local runtime tests exercise resource admission, smoke accuracy/speed/memory validation, activation ordering, duplicate-setting rejection, and idempotent environment preservation through Bash. They do not install packages, compile Linux binaries, or establish VPS performance:

```sh
node --test scripts/tests/native-transcription-provision.test.mjs
bash -n scripts/provision-native-transcription.sh
```

Until the VPS provisioner has passed and the API has been restarted and checked, native transcription is prepared but not verified operational. The multilingual base model supports automatic language selection; this public English sample does not establish recognition quality for all languages or oilfield terminology.
