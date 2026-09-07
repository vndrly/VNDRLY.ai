# Authenticated AskV live validation

Date: September 6, 2026. The final combined run exited **0**. No deployment,
push, OTA, or TestFlight submission was performed by this validation.

## Actual application boundary

`scripts/verify-askv-authenticated-live.mjs` runs only after the additive
`fresh-local` database wrapper has created a unique empty local database and
checked the schema. It asserts the wrapper's loopback URL and provenance
contract before importing the database. Every attempt retains its new database;
none resets, drops, or reuses an existing database.

The harness inserts one uniquely named synthetic admin with a random test-only
password. It does not seed or modify canonical demo accounts. It explicitly
reads only the approved OpenAI server credential after the wrapper has removed
provider credentials and disabled automatic environment-file loading. The key
stays server-side and is never printed.

The actual Express `app.ts` serves all normal middleware and API routes on a
random `127.0.0.1` port. The source entry-point compatibility shim supplies the
same `createRequire` behavior used by the normal API build. The harness does
not launch `index.ts`, demo provisioning, or background workers. Vite serves
the actual web application and proxies its API to that isolated server on a
second random loopback port. It does not reuse the separate E2E servers.

Headless Edge uses the real `/api/auth/login` endpoint through its cookie-aware
request context, then opens and operates the actual AskV panel. This proves the
authentication route and session cookie; it does not click through the login
form. Its microphone is a generated Windows speech WAV containing only “What is
two plus two?” and silence. No physical microphone is opened. Follow-up prompts
use a synthetic confirmation phrase and ask for its recall after reopening.

The production Realtime routes use the real OpenAI provider, model/session
configuration, current role-filtered tool pack, navigation context, greeting,
transcription, and server VAD. Browser requests to domain tool execution are
blocked before reaching an action; the final run made **zero** such requests.
No production data or messages to another person are involved.

## Final observed result

Final database: `vndrly_8736e29e06b1493e8fea6919ed7a505a_test` (retained locally).

| Check | Observed result |
| --- | --- |
| Anonymous conversation access | Rejected with 401 |
| Actual login route and cookie | Accepted synthetic account |
| Initial full greeting | Spoken; daily greeting claim saved on the test user |
| Automatic voice turn | One VAD start/stop; answer generated without a manual response trigger |
| Typed follow-up | Voiced reply on the same connection, containing the requested confirmation |
| Initial transport | One microphone, one peer, three playback starts/stops |
| Actual received audio | 150,877 RTP bytes; audio energy 0.6850691561932883 |
| Initial history | Five rows: two user and three assistant messages |
| Muted reload | Exact message IDs, roles, contents and order matched SQL; UI counts matched |
| Muted startup | Preference persisted; zero microphone acquisitions |
| First shutdown | All tracks ended and peer closed before the resumed session |
| Live resumed history | Provider acknowledged all three restored assistant messages |
| Recall after reopening | Live answer recalled the earlier confirmation without receiving the phrase in the resumed prompt |
| Resumed transport | One new microphone and peer; two playback starts/stops |
| Final persistence | Eight successful transcript saves and eight unique message rows in the same conversation |
| Provider/API failures and tool requests | Zero |
| Broker calls | Exactly two: initial and resumed sessions |

The existing five history rows remained byte-for-byte equivalent in the ordered
ID/role/content comparison after resuming. Typed markers were saved exactly
once. The assertion permits provider VAD segmentation and digit normalization
while requiring the combined persisted spoken request to match the synthetic
math question. A preliminary attempt reached both successful voice and typed
replies but exposed an overly strict test assumption about VAD segment count;
the application did not fail on that attempt.

Each session produced one harmless `response_cancel_not_active` event when the
client cancelled before typing with no active response. Both clients already
tolerate that event. There were no other protocol errors in the final run.

Both sessions ended their microphone tracks and closed their peers. Final
cleanup reported browser closed, Vite stopped, API stopped, database pool ended,
and generated audio removed. A subsequent operating-system process check found
zero Node processes still running the authenticated verifier. The local database
was retained; stopping the shared local PostgreSQL cluster remains the parent
validation task's responsibility.

## Provider defects exposed and corrected

1. The full application tool pack was rejected with HTTP 400,
   `unknown_parameter`, parameter `session.tools[0].strict`. A bounded provider
   comparison accepted the same tool after removing only that field. The
   Realtime serializer now omits unsupported tool-level `strict`. Closed JSON
   schemas, required/nullable normalization, server validation, role checks,
   permissions, confirmation requirements and idempotency are preserved.
2. The web navigation context item was rejected with `string_above_max_length`,
   parameter `item.id`, maximum **32**, supplied length **36**. Context IDs now
   use `ctx_` plus 28 UUID hex characters. They remain unique, and replacement
   deletes the exact prior ID. Native context/history already delegate IDs to
   the provider; native typed timestamp/counter IDs were checked and left intact.
3. Independent review found both clients restored assistant history with the
   obsolete content type `text`. The current GA schema permits `output_text`
   or `output_audio` for assistant messages. Both clients now send `output_text`;
   the resumed live run confirms provider acceptance and useful recalled
   context. See the [official Realtime client-event schema](https://developers.openai.com/api/reference/resources/realtime/client-events).

The server strict-field regression and web ID-limit regression failed before
their fixes. Assistant-history payload regressions failed in both clients before
the correction. Final focused results: **15 server tests / 3 files, 10 web
transport tests, 9 mobile transport tests**, all passing. API, web and mobile
TypeScript checks passed. The production web build passed in **18.79 seconds**
with 3,694 transformed modules and existing non-fatal sourcemap/chunk warnings.

`scripts/verify-askv-realtime-tool-schema.mjs` retains the optional synthetic,
non-conversational contract comparison: unsupported `strict:true` must fail at
the exact parameter, and the production tool shape must be accepted. It prints
only status and allowlisted error metadata, never the returned client secret.
`scripts/askv-provider-vitest.config.mjs` runs the three pure provider contract
test files without importing a database or bypassing database guards.

## Reproduction and remaining boundaries

Run from the repository root with existing dependencies, Edge, the approved
OpenAI credential file, and a separately started local PostgreSQL maintenance
endpoint. This is an explicit live-provider test with normal provider usage.

```powershell
$env:VNDRLY_TEST_DB_MODE = 'fresh-local'
$env:VNDRLY_TEST_DB_MAINTENANCE_URL = (Get-Content -LiteralPath '<local-maintenance-url-file>' -Raw).Trim()
$env:ASKV_AUTHENTICATED_LIVE_TEST = '1'
node artifacts/api-server/node_modules/tsx/dist/cli.mjs artifacts/api-server/scripts/run-with-test-db.ts -- node artifacts/api-server/node_modules/tsx/dist/cli.mjs scripts/verify-askv-authenticated-live.mjs
```

Use the repository's pinned pnpm 9 through Corepack for the wrapper's nested
schema command; the local ignored validation PATH shim supplies that routing on
the Windows validation machine. The harness permits at most two provider calls.
Its network/playback waits are bounded, and errors report only allowlisted
provider metadata and counts. Generated audio is temporary; transcripts stay
only in the synthetic local database and browser memory during the run.

This covers the authenticated conversation lifecycle on desktop Edge with
synthetic audio. Physical iPhone/iPad routing, Bluetooth, interruption/background
behavior, permissions/revocation, field noise/accents/plates, five-minute live
idle, and deployment remain explicit separate gates. The signed native compile
baseline at `200ea71` predates the subsequent mobile JavaScript transport and
history corrections; it does not constitute physical-device acceptance of them.
