# Gate recognition and future vehicle observations

John's 2026-11-12 scope: implement the plate-reader improvements; evolve vehicle
photos toward a composite photo/video vehicle fingerprint; keep web/iOS gatekeeper
delivery first and the broader site-awareness package on the back burner.

## Gatekeeper implementation

Both capture actions call the existing authenticated, rate-limited, owner-checked
read-plate endpoint. `mode: vehicle` requests visible vehicle attributes as well as
a plate. No recognition saves a visit, clears a vehicle, identifies a driver, or
checks anyone out. An operator reviews the photo, edits the plate/state and accepts
the suggestion. Exact plate matches then surface existing history/checkout flows.
Unknown state remains optional; conflicting known states cannot match. Appearance
alone never establishes identity. Two white pickups remain two possible vehicles.

Web decodes, orients and converts images to JPEG, preserving up to a 2560-pixel
edge. Gate capture on mobile uses higher image quality and the native crop editor.
Web offers an operator-drawn crop with keyboard controls and re-reading. Upload/reader limits align
at 8 MB. Unsupported formats, upload problems, unreadable content and provider
failure are recoverable through manual entry. Photo evidence survives OCR failure
after a successful upload. Every provider result requires review; model scores
are not calibrated probabilities.

The default engine remains the configured OpenAI model. Production responses use
JSON mode and reject prose/malformed/truncated output. Vehicle descriptions are
bounded and exclude people. Requests have a 12-second total deadline, including
one retry for HTTP 429/502/503/504. The specialist adapter is opt-in using
`GATE_PLATE_OCR_PROVIDER=plate-recognizer` and `PLATE_RECOGNIZER_API_TOKEN`.
Vehicle descriptions continue to use OpenAI. No automatic cross-provider fallback
sends images to an unexpected service. No new package dependency is required.

## Evaluation before switching engines

Use an authorized, labeled set of actual gate photos with disjoint training/tuning
and evaluation sets. Include daylight, night, glare, mud, angled/distant captures,
temporary plates, trailers, no plate, several vehicles, and same-looking vehicles.
Keep evaluation photos and labels out of git. Start with a representative pilot,
then enough independent observations to estimate rare wrong-read rates. Never
infer production accuracy from parsing tests or vendor marketing.

From artifacts/api-server, invoke with configured environment:

    pnpm exec tsx scripts/benchmark-gate-recognition.ts /path/manifest.json openai
    pnpm exec tsx scripts/benchmark-gate-recognition.ts /path/manifest.json plate-recognizer
    pnpm exec tsx scripts/benchmark-gate-recognition.ts /path/manifest.json predictions /path/fastalpr-results.json

Manifest rows: `{id,file,plate,state,condition}`. `file` is relative to the manifest;
unknown/no-plate ground truth is null. External prediction files map each ID to
`{plate,state,elapsedMs}`; FastALPR can supply those without adding a Python service
to the production gatekeeper deployment. Reports contain only aggregated metrics.

Measure exact plate/state matches, wrong reads, missed reads, errors and p95 latency
by condition. Separately measure operator correction rate, retakes, time to saved
entry and cost per confirmed entry in a staffed pilot. Preserve all review controls
until a validated calibration study supports a more automatic policy.

References: https://guides.platerecognizer.com/docs/snapshot/api-reference/
and https://github.com/ankandrew/fast-alpr (review model licenses as well as code).

## Deferred site-awareness design

Keep four separate concepts:

1. **Observation:** tenant/site/gate, device and source, capture and receipt times,
   evidence references, image/video-frame quality, provider/model version, plate
   candidates, appearance descriptors, optional embedding and embedding version.
   Add a source event ID for deduplication and a sequence number for offline replay.
2. **Vehicle profile:** stable internal vehicle ID, confirmed plate aliases and
   dated reference views. Tractor/trailer combinations have separate identities.
   A plate change, repaint, removable logo or damage can change the appearance.
3. **Association:** observation-to-profile candidate, evidence and disagreement,
   operator confirmation/rejection, actor and time. Preserve rejected alternatives;
   do not rewrite history or treat an appearance hash as a unique fingerprint.
4. **Movement:** confirmed association plus source/zone/time. Integrate with the
   existing gate movement and offline observation services instead of replacing
   them. Unknown and conflicting sightings remain unknown; do not invent a route
   through blind spots or equate camera silence with departure.

Composite capture should collect several views of one vehicle, detect/crop the
vehicle and plate per frame, discard duplicate/blurred frames, then retain the
source evidence behind each proposed attribute. Video requires explicit bounded
duration/frame sampling and a separate retention policy. Camera ingestion is a
separate worker behind the observation contract; it must not delay gate check-in.

Tenant isolation applies to evidence, profiles, searches and stream delivery.
Clients cannot supply a trusted tenant ID or confirm an association for another
site. Enforce permissions server-side. Configure retention and deletion for raw
media and derived descriptors together. Offline recognition requires an on-device
engine or reachable gate appliance; a cloud adapter cannot supply it.

A future commercial module can meter camera/device subscriptions, observations and
retention independently of core gatekeeper access. Compliance colors come from
saved, current rules and records with an explanation and timestamp: green cleared,
amber unknown/needs review, red confirmed violation. Never infer clearance from
appearance or convert an uncertain recognition into a violation.

People movement is limited to non-biometric approaches such as badges, QR codes
and opted-in location devices. Facial identification across workplace cameras is
outside this implementation and design.

## Current limits

Vehicle appearance is currently a review-time descriptor, not a persisted unique
profile or a trained re-identification model. Composite video, automatic plate detection/cropping,
automatic blur/glare detection, camera ingestion, calibrated accuracy, correction
analytics and offline recognition are not yet implemented. The benchmark runner
requires actual labeled photographs; no real-world accuracy is claimed.

## Verification checkpoint — 2026-11-12

- Recognition API helper tests: 21 passed (parser, bounded retries/deadline,
  format rejection, ambiguous images, attributes and specialist adapter).
- Web gate and photo-normalization tests: 35 passed.
- Mobile gate and photo authorization-scope tests: 25 passed.
- Shared plate-state/matching tests: 14 passed.
- English/Spanish parity passed for web and mobile.
- Focused recognition TypeScript check passed, including the benchmark runner.
- Benchmark scoring runner passed a two-row synthetic prediction smoke test.
  This validates arithmetic only, not image recognition accuracy.
- API route suite could not complete successfully: local test connections failed
  with `connect EACCES 127.0.0.1`. No database reset or wipe was used.
- A live OpenAI smoke test on a generated synthetic plate failed at transport with
  `ENOTFOUND`; no successful live recognition is claimed.
- Local OpenAI configuration is present. No Plate Recognizer token was present in
  the loaded configuration. A labeled real-photo benchmark has not been run.
- These changes are local and not deployed, merged or submitted to TestFlight.
  Broad release validation, device camera testing and a real-photo pilot remain
  required before calling the recognition production-ready. The MidCon hold was
  not changed.
