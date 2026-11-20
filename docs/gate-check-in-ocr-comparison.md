# Gate check-in and OCR comparison

Measured November 20, 2026, on the local Windows workstation. No real visits were submitted during benchmarking.

## Implemented flow

Entering the check-in form opens AskV focus and starts the existing voice session when unmuted. The top panel mirrors the current form. Recognition fills the actual form without an OCR acceptance button. Manual edits made while the photo is processing are retained. Unknown states and low-confidence plate readings are not used to infer identity.

One explicit spoken submit authorizes the current check-in form. The API checks that supplied fields match the visible draft; it retains role checks, normal domain validation, audit and idempotency. Photo capture alone does not save a visit. The previous Add more / Confirm dialogue is removed. Web and native Gate capture use the same behavior; the iOS WebView starts the native voice owner through the existing validated bridge.

Original and normalized evidence uploads run concurrently with inline FastALPR recognition. The form fills before storage finalization. A spoken submit waits quietly for pending evidence, then uses the current draft and stored image paths. Upload failures and cancellation cannot silently submit a different or evidence-less draft.

## Measurements

Five public images, three reads per image, same images for each engine. Four images have published OpenALPR US ground truth; the fifth is FastALPR's Czech example. Times below are recognition, not end-to-end app latency.

| Engine | Recognition range | Mean | Correct US plates |
| --- | --- | --- | --- |
| Current gpt-4o-mini | 1,232–2,416 ms | 1,755 ms | 3/4 |
| FastALPR, 384 detector | 25–68 ms | 37 ms | 3/4; one undetected |
| FastALPR, 640 detector | 65–137 ms | 88 ms | 3/4; all detected |

Comparison ignores punctuation separators, but never conflates zero and O. Both gpt-4o-mini and FastALPR 640 returned OSG719 for the labeled 0SG719 plate. These repeated reads are a tiny feasibility check, not a production accuracy estimate. FastALPR uses a warmed CPU model; the first 384 model initialization, including downloads, took 4.9 seconds. Keep models resident in a service when evaluating deployment.

The actual authenticated local browser path took **15,611 ms** from selecting the FastALPR sample file to a populated field, failing the requested five-second target. The last evidence-upload finalization returned at 5,951 ms; read-plate returned at 15,585 ms. This includes app/network/storage overhead that direct inference timings omit. No server-side timing breakdown was captured for that browser request, so its remaining time cannot all be attributed to the model.

Two subsequent attempts reused the same file input and did not fire another capture; these were invalid trials and are excluded. The initial admin test returned 403 because that account lacked assigned Gate access and is also excluded. An obsolete Plate Recognizer demo URL returned HTML; those invalid image attempts are excluded.

## FastALPR implementation and limits

FastALPR 640 is now the default API engine, using a resident Python subprocess with preloaded CPU models. Provision with `node scripts/setup-fastalpr.mjs`; Python 3.11+ is required for the pinned ONNX Runtime. The API deployment workflow installs the runtime and resolves the models before restarting. The API warms its worker at startup. A four-second recognition deadline and bounded queue prevent a stalled model from indefinitely blocking a form.

Seven authenticated local browser reads after integration took **603–963 ms** from file selection to a populated plate field (822, 963, 932, 877, 627, 763, 603 ms). All seven meet the five-second target. Four reads use the labeled US photos. The zero/O mismatch remains visible and editable. These are local browser measurements, not physical-phone or production latency claims.

FastALPR does not supply a validated US issuing state; its country classification is not placed in the state field. Gatekeepers can correct any populated plate and enter the state. A low confidence score no longer withholds a detected plate from the form. No OCR-specific acceptance step is added. Multiple detected plates remain unresolved instead of selecting a different vehicle arbitrarily. FastALPR does not generate OpenAI-style vehicle appearance descriptions.

Production publication and native TestFlight verification are tracked separately in the release ledger.

## Reproduction evidence

Local results: `.local/plate-benchmark/current-us.json`, `fastalpr.json`, `fastalpr-640.json`, `ground-truth.json`, `browser.json`, `browser-fastalpr.json`, `browser-fastalpr-us.json`.

Runners: `.local/plate-benchmark-us.ts`, `.local/plate-fastalpr-benchmark.py`, `.local/plate-fastalpr-640-benchmark.py`, `.local/gate-focus-john-benchmark.mjs`. Browser reruns must clear the file input or use a distinct filename to trigger another capture.

Sources: [FastALPR](https://github.com/ankandrew/fast-alpr), [FastPlateOCR](https://github.com/ankandrew/fast-plate-ocr), [OpenALPR benchmark images and labels](https://github.com/openalpr/benchmarks/tree/master/endtoend/us), [Plate Recognizer Snapshot](https://guides.platerecognizer.com/docs/snapshot/faq/). VNDRLY already has an opt-in Plate Recognizer adapter; it was inspected but not benchmarked in this round.
