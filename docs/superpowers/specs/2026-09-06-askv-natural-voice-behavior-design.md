# AskV Natural Voice Behavior Design

Date: 2026-09-06  
Status: Product scope approved; implementation authorized in subsequent user requests and reconciled on `codex/askv-cursor-reconcile`. Native baseline compilation and authenticated live-service/resumed-history checks pass. A final release binary and physical-device/field acceptance remain; see `docs/askv-reconciliation-report.md`.

## Objective

Make AskV a natural, voice-first assistant across the VNDRLY web and iOS
applications. Opening AskV should be the only routine action required to begin
a conversation: AskV greets the user, listens, detects the end of each
utterance, answers automatically, and listens for follow-up questions.

This design replaces the separate Gate Voice interaction with AskV while
preserving Gate check-in and check-out outcomes. It deliberately defers the
larger office and financial action packs until the core interaction is proven
reliable.

This design supersedes the one-command and always-wake-listening interaction
details in `2026-07-03-askv-realtime-voice-design.md`. The earlier design's
server-owned tools, role enforcement, confirmation, auditing, and raw-audio
retention rules remain authoritative unless this document explicitly changes
them.

## Approved Experience

### Opening AskV

- The behavior applies to both the web and iOS applications.
- Clicking or tapping AskV opens a Realtime voice session and starts listening
  without a separate Record or Submit action.
- The operating system or browser may require an unavoidable microphone
  permission response on first use. Once permission is granted, opening AskV is
  a one-action interaction.
- AskV gives a personalized, time-appropriate full greeting on the first open
  of each local calendar day, for example: "Good morning, Brian. I'm listening
  and ready when you are. How can I help?"
- Later opens that day use the shorter greeting: "I'm listening."
- The full-greeting state is tracked per signed-in user by the server so web
  and iOS do not both deliver a first greeting on the same day. The client
  supplies its local time zone for the calendar-day decision.

### Conversation

- Voice activity detection determines when the user has finished speaking.
  AskV does not ask the user to approve a transcript and does not require a
  Submit action.
- AskV answers automatically, then listens for the next turn.
- Users may interrupt AskV while it is speaking. AskV stops the current audio,
  accepts the interruption as the next turn, and keeps the conversation
  context.
- The active conversation expires after five minutes with no new user turn.
  The timer begins after AskV finishes its response and returns to listening;
  each accepted voice or typed turn resets it.
- Typed questions use the same conversation and remain available while voice
  is listening, thinking, or speaking.
- Voice transcripts appear in the same history as typed messages. Raw audio is
  not retained by VNDRLY.

### Mute

- A visible mute control immediately stops microphone capture and spoken
  output without disabling typed AskV.
- Mute is remembered per signed-in user and device/browser until that user
  explicitly unmutes.
- Unmuting while AskV is open starts or resumes an active conversation.
- Only one VNDRLY feature may own the microphone at a time.

## AskV Across VNDRLY

Listening outside the AskV screen is optional and disabled by default.

When the user enables **AskV across VNDRLY**:

- The active five-minute conversation survives navigation between screens and
  tabs within the foreground application.
- Navigation sends updated screen, record, organization, and location context
  to AskV without replacing the active conversation.
- After the active conversation expires, the client leaves Realtime and enters
  a lower-cost wake-idle mode.
- In wake-idle mode, the exact phrase "AskV" starts a new Realtime
  conversation. The single-letter phrase "V" is not a wake phrase because its
  false-activation risk is too high.
- A persistent global indicator distinguishes Listening, Thinking, Speaking,
  Wake enabled, and Muted states.
- Returning to the AskV screen shows the current conversation and its state
  rather than creating a second session.

AskV across VNDRLY operates only while the app or browser tab is foregrounded.
Hiding the browser tab, backgrounding or locking iOS, logging out, switching
accounts, losing microphone permission, or explicitly muting ends microphone
capture. An iOS phone call or audio-route interruption pauses AskV and permits
a safe resume when the application becomes active again.

## Architecture

### Active conversation layer

OpenAI Realtime over WebRTC provides duplex audio, voice activity detection,
spoken output, and interruption handling. VNDRLY's API brokers the session so
permanent provider credentials never ship to a browser or iOS client.

The active voice lifecycle is:

`stopped -> connecting -> greeting -> listening -> thinking -> speaking -> listening`

It may also transition to `muted`, `wake-idle`, `interrupted`, or `error`.
There must be one state owner per signed-in client so navigation cannot create
overlapping sessions.

### Wake-idle layer

Wake-idle is separate from Realtime. It should use an on-device wake-word
engine where supported so full conversation audio is not streamed or billed
while waiting for "AskV." Selecting a production wake engine is an explicit
implementation prerequisite because:

- the existing browser Speech Recognition wake loop is not consistently
  available across supported browsers;
- the current iOS code has a phrase matcher but no live wake listener; and
- keeping a Realtime call open solely for wake detection would undermine the
  five-minute cost and privacy boundary.

If wake detection is unavailable on a device or browser, the product must show
that limitation and fall back to opening AskV manually. It must not imply that
AskV is listening when it is not.

### Cross-navigation ownership

- Web mounts one authenticated voice provider above the application routes.
- iOS mounts one voice provider above the Expo Router tab and screen stacks.
- AskV panels and screens render the shared session; they do not own or destroy
  it.
- The provider receives route changes and publishes compact context updates to
  the active Realtime session.
- A session is uniquely keyed by user, organization membership, device, and
  conversation. Switching organization context ends the old session before a
  new one can start.

## Platform Scope

### Web

- Extend the existing AskV WebRTC client from a one-command call into the
  approved multi-turn lifecycle.
- Opening the AskV panel starts the session from the user's click, satisfying
  browser media-autoplay and microphone gesture requirements.
- Change global wake listening from its current default-on behavior to the
  explicit AskV-across-VNDRLY preference.
- Keep the session provider mounted during client-side navigation and update
  page context as the route changes.
- Preserve typed AskV and the current record/transcribe path as clearly
  identified fallbacks when Realtime cannot start.

### iOS

- Replace the AskV screen's timed record/transcribe/answer/speak loop with a
  native WebRTC Realtime client.
- Add native audio-session handling for microphone capture, speaker and
  headset routes, echo cancellation, Bluetooth, interruptions, and cleanup.
- Keep the voice provider above Expo Router so changing screens does not
  unmount the session.
- Remove the separate Gate Voice navigation item. AskV remains the single
  voice entry point.
- A native WebRTC module and an on-device wake-word solution require explicit
  dependency selection, privacy review, native builds, and TestFlight
  validation; this work cannot ship as an OTA-only JavaScript update.

## Gate Voice Consolidation

AskV replaces the standalone Gate Voice transcription and command parser after
behavioral parity is verified.

AskV must support:

- visitor check-in and check-out;
- first and last name, company, license plate and state, purpose, notes, and
  expected duration;
- site and partner context;
- matching active visits for check-out;
- concise follow-up questions for missing information;
- a short choice when multiple active visits match;
- the existing permission, site, GPS, duplicate, and validation rules;
- a spoken summary and confirmation before committing check-in or check-out;
  and
- immediate refresh of Gate state and visit history after success.

The web Gate portal retains its existing circular **Voice** control and visual
treatment. It becomes the global AskV mute/unmute switch. Its accessible label
states "Mute AskV" or "Unmute AskV," and its visible state must not claim that
AskV is listening when it is merely available.

The iOS Gate navigation removes the separate Voice item instead of duplicating
the AskV tab. The remaining Gate navigation adapts from five items to four.

The legacy Gate parser, recording session, and confirmation UI remain in place
as fallback until equivalent AskV tests and production validation pass. They
are removed only after the AskV path covers every approved Gate Voice outcome.

## Core AskV Toolbox

The first release includes a focused operating toolbox rather than every
office workflow.

### Context and navigation

- Resolve references such as "this ticket," "my next job," "this site," or
  "that visitor" from explicit speech, current screen, selected record, active
  assignment, permitted location, and recent conversation context.
- Open permitted screens, focus or highlight a relevant control, and prefill a
  draft without bypassing normal validation.
- Launch maps, camera, scanner, or other native capabilities through explicit
  client tools rather than pretending a server tool completed a client action.

### Gate

- Prepare and confirm visitor check-in.
- Find and disambiguate active visitors.
- Prepare and confirm visitor check-out.
- Query current visitors and visit history within the user's permitted scope.

### Field tickets

- Query the current, next, or named ticket.
- Mark en route, arrived/on location, onsite/start work, work complete, and
  offsite.
- Close a ticket for review after spoken confirmation.
- Add a ticket note or comment.
- Start the existing photo, parts, labor, and mileage entry flows with known
  context prefilled; AskV must ask for missing facts and must not invent them.
- Query route, ETA, crew status, mileage, and ticket proof.

### Briefing and safety

- Read the existing role-scoped attention briefing and notifications.
- Create a safety-report draft from dictated facts.
- Review the draft and require confirmation through the existing safety
  workflow before any final submission.

## Deferred Tool Packs

The following are explicitly outside this core project and should follow only
after interaction quality, tool correctness, and field adoption are measured:

- Hotlist creation, bidding, comparison, and awarding.
- Partner ticket approval and kickback actions.
- Invoice approval, payment, funds disbursement, reversal, and other financial
  mutations.
- Broader accounting, 1099, and reporting actions.
- General vendor and partner office administration beyond the read-only tools
  already available.
- Locked-screen or operating-system-background wake listening.

Existing read-only office queries remain available where role permitted, but
expanding their write capabilities is not part of this scope.

## Tool Contract And Selection

AskV tools are domain operations, not raw API endpoints. Each tool declares:

- allowed roles and organization scope;
- whether it is read-only or mutating;
- risk level and confirmation policy;
- required context and input schema;
- idempotency behavior;
- audit target;
- whether execution is server-side or a client capability; and
- a concise voice-safe success or failure result.

Do not send the complete catalog into every Realtime session. The server
provides:

1. a small always-available core;
2. the user's role pack; and
3. the current screen or workflow pack.

The active tool set updates as context changes. Server-side authorization is
always rechecked during execution; hiding a tool from the model is not an
authorization boundary.

## Safety And Confirmation

- Questions and read-only lookups answer automatically.
- Low-impact, reversible actions may execute automatically and offer a brief
  acknowledgement or undo path.
- High-impact actions require a spoken summary and confirmation. This includes
  Gate check-in/check-out, ticket close-for-review, safety submission, crew
  reassignment, external/customer-facing messages, compliance records, and
  financial actions.
- Confirmation is bound to the exact pending tool, arguments, user, and
  organization. It expires when the context changes or the session ends.
- A generic "yes" cannot approve an action when no confirmation is pending.
- Low recognition confidence triggers one concise clarification question, not
  transcript approval.
- Every mutation has an idempotency key so reconnects, duplicate model events,
  and repeated speech cannot execute it twice.
- Every mutation uses existing server permission checks and writes the AskV
  action audit trail.

## Privacy, Cost, And Reliability

- VNDRLY stores transcripts and action metadata but no raw audio by default.
- A microphone indicator remains visible on every screen where capture is
  possible.
- The active Realtime call closes after the five-minute idle window, on mute,
  or on foreground/session loss.
- Wake-idle does not keep a billable Realtime conversation open.
- Context sent to the model is limited to the authenticated role, active
  organization, relevant screen/entity, and minimum location metadata needed
  for the request.
- Realtime sessions use compact role and screen tool packs to reduce schema
  tokens, latency, and incorrect tool selection.
- Typed AskV remains functional after microphone denial or voice failure.
- The current record/transcribe path remains a temporary fallback during
  rollout and for supported clients where Realtime fails.

Operational metrics include session starts, time to first audio, turn latency,
interruptions, false wakes, corrections, fallback rate, tool success and
denial, duplicate prevention, idle duration, and provider cost per
conversation. Metrics must not contain raw audio.

## Error Handling

- Microphone denied: explain how to enable it and leave typed AskV usable.
- Realtime unavailable: preserve the typed conversation and offer the explicit
  recording fallback.
- Wake engine unavailable: show manual-open behavior; do not show Wake enabled.
- Network loss: stop claiming an action is in progress, preserve safe pending
  context, and retry only after reconnection or user direction.
- Ambiguous record or person: ask one short disambiguation question.
- Tool denied: explain the role or organization boundary without exposing
  hidden records.
- Tool failure: state that the action did not complete and retain inputs for a
  safe retry.
- Audio interruption: pause capture and output, then resume or visibly stop
  according to application lifecycle state.

## Delivery Sequence

1. Select and validate the native WebRTC and cross-platform wake-word
   dependencies, including supported browsers, iOS audio behavior, licensing,
   privacy, and build impact.
2. Define the shared voice state, context, tool-risk, confirmation,
   idempotency, and session contracts.
3. Add Gate and field-operation server tools by reusing existing domain
   services and permission checks.
4. Extend the web Realtime path and mount its session above navigation.
5. Add the native iOS Realtime path and root-level session ownership.
6. Add AskV-across-VNDRLY preferences, wake-idle, global status, and the
   persistent mute contract.
7. Run Gate Voice parity with both paths available behind feature flags.
8. Pilot with internal users, evaluate field-condition metrics, and remove the
   legacy Gate Voice path only after its replacement is verified.
9. Evaluate the deferred office and financial tool packs as a separate
   follow-on project.

## Verification Requirements

### Automated

- Shared state-transition tests cover open, greeting, listen, automatic turn,
  response, barge-in, five-minute idle, wake-idle, mute, navigation, and
  cleanup.
- API tests cover authentication, role and organization gates, contextual tool
  selection, confirmation binding, idempotency, auditing, and raw-audio
  exclusion.
- Web tests cover browser media permission, panel-open start, route survival,
  tab hiding, typed/voice continuity, Voice-button mute, wake support fallback,
  and Realtime fallback.
- iOS tests cover root-level session survival, navigation, app lifecycle,
  audio interruptions and routes, persistent mute, wake support, and removal
  of the Gate Voice navigation item.
- Gate parity tests cover every recognized field, missing and ambiguous data,
  check-in, check-out, cancellation, validation failure, duplicate prevention,
  and immediate cache refresh.
- Tool tests cover each risk classification and prove that duplicate events do
  not duplicate mutations.

### Manual

- Supported desktop and mobile browsers with allow, deny, revoke, and repeated
  microphone permission states.
- Physical iPhone and iPad testing with speaker, wired/Bluetooth audio, phone
  interruption, screen lock, background/foreground, and poor connectivity.
- Noisy truck, gate, and office conditions with representative names, company
  names, license plates, ticket numbers, and accents.
- Voice-to-typed and typed-to-voice turns in one conversation.
- Navigation across the app during active conversation and wake-idle.
- High-impact confirmation, cancellation, correction, and reconnect duplicate
  prevention.

## Acceptance Criteria

The core project is complete only when:

- opening AskV on web or iOS starts a greeted conversation after at most the
  required first-use operating-system permission response;
- routine questions require no Record, transcript approval, or Submit action;
- automatic turn detection, spoken answers, follow-ups, and barge-in work on
  both platforms;
- the session ends after five minutes without a new user turn;
- mute is immediate, persistent, and leaves typed AskV usable;
- AskV across VNDRLY is opt-in, survives foreground navigation, updates
  context, and enters truthful "AskV" wake-idle after timeout;
- iOS navigation no longer contains the separate Gate Voice action;
- the web Voice control mutes and unmutes AskV;
- AskV completes Gate Voice workflows with equivalent validation,
  confirmation, and visible results;
- the approved core toolbox works within role and organization scope;
- consequential actions require bound spoken confirmation and cannot execute
  twice;
- raw audio is not stored by VNDRLY;
- failure and unsupported states fall back visibly without claiming to listen;
  and
- office and financial write packs remain outside this release.
