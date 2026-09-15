# iOS Field Mode Completion Design

**Status:** Approved for unattended implementation and TestFlight delivery
**Date:** 2026-09-15
**Platform:** iPhone and iPad, plus shared API support required by iOS
**Foundation:** docs/plans/2026-09-13-implementation-a-design.md and docs/superpowers/specs/2026-09-06-askv-natural-voice-behavior-design.md

## Outcome

Finish the iOS field experience so Ask V remains the same assistant throughout the signed-in app and Gate becomes a live, voice-first operating surface. Gate attendants must keep traffic moving, onboarded drivers must complete repeated hauling loops without ending their work trip, supervisors receive unresolved exceptions, and location collection stops at the end of work.

This is a completion pass over Implementation A. It extends the existing trip, Gate, offline queue, authorization, safety, notification, and Ask V subsystems.

## Locked decisions

### Ask V

- Ask V is enabled across every authenticated iOS screen, including Gate.
- Navigation never creates a second assistant session or discards the active conversation.
- Global mute stops capture and speech without clearing the session; unmute resumes on the current screen.
- Ask V remains conversational for five minutes after the last completed turn unless the user says they are done.
- Raw voice audio is not retained by default.
- Routine input errors cause one focused clarification. Plate camera use requires acceptance.
- Genuine system failures and missing capabilities enter operations health. User validation errors do not.

### Gate

- Gate attendants operate their assigned site. Gate Supervisors may switch among authorized sites; voice actions apply to the selected site.
- Confident routine check-ins and checkouts complete immediately. Ambiguous input produces one short clarification without blocking the lane.
- Incomplete observations survive for same-shift supervisor resolution. Later checkout facts may backfill the check-in with an audit trail.
- Gate changes reach authorized foreground devices within two seconds under normal connectivity.
- Stale concurrent edits never overwrite the authoritative record.
- Offline events remain available; conflicts preserve both events and route to the Gate Supervisor.

### Driver Field Mode

- Field Mode is work-bound and starts only for an authenticated, consented user with an active shift, approved early start, or active trip.
- A scheduled gate attendant entering the assigned site enters Field Mode and hears one short ready acknowledgement.
- An onboarded driver starts a hauling trip before arrival. A verified entry creates the check-in automatically.
- Site exit records a departure but does not complete an active hauling trip. Re-entry records another arrival under that trip.
- The driver explicitly ends work. At shift end or an unassigned departure, Ask V asks whether work is complete.
- No answer for 15 minutes stops tracking, marks supervisor confirmation required, and notifies the responsible foreman or Gate Supervisor.
- Remaining inside an assigned site never triggers checkout or inactivity.
- An offsite stop of 45 minutes triggers a private Ask V check-in. No answer for another 15 minutes creates a supervisor exception but does not treat lunch as checkout.
- Retained operational history emphasizes arrivals, departures, crossings, and qualifying stops. VNDRLY does not intentionally track after work ends.

### Safety and access

- Incidents are timestamped immediately and normal Gate work stays available.
- Emergency calling requires human confirmation.
- Urgent incidents use push and SMS, require acknowledgment, and follow the escalation chain. Routine Gate exceptions start with the Gate Supervisor.
- Partner users see authorized sites. Vendor users see their workers, vehicles, and visits. VNDRLY administrators retain platform scope.
- Actions belong to the signed-in user. Shared devices sign out between attendants and lock after 15 minutes without ending the shift.

## Architecture

1. Add a pure mobile Field Mode reducer that consumes work context, geofence, motion, app state, and time and emits deterministic effects.
2. Mount one app-level coordinator to execute those effects. It owns timers and adapters but not policy.
3. Keep field trips active across ordinary exits. Add explicit, versioned completion with a completion reason and supervisor-confirmation flag.
4. Add a scoped Gate invalidation stream. Events invalidate authoritative queries; reconnect gaps force a full refresh. Use bounded foreground polling only as fallback.
5. Keep AskVVoiceProvider as the only microphone and conversation owner. Gate push-to-talk cannot compete with global Ask V.
6. Stop location collection before escalating any unattended end-of-work exception.

All database changes are guarded and additive. No new external dependency is allowed.

## Acceptance

- Gate navigation, mute, foreground return, and page changes preserve one Ask V session.
- A scheduled attendant receives one Field Mode ready event on assigned-site arrival.
- A driver can exit and re-enter multiple times under one active trip.
- Explicit completion stops tracking immediately.
- Unanswered end-work prompts stop tracking after 15 minutes and create one supervisor exception.
- Offsite stops prompt after 45 minutes and escalate only after another 15 minutes.
- Gate updates arrive within two seconds with reconnect fallback.
- Offline duplicates coalesce and conflicts remain reviewable.
- English/Spanish, accessibility, unit, integration, mobile screen, API, and browser gates pass.
- Completion is a successful TestFlight build and App Store Connect submission.

## Out of scope

- App Store Ready for Sale publication.
- Automatic emergency calling.
- Off-duty location tracking.
- New external wake-word, streaming, or mapping dependencies.
- Unrelated cosmetic redesign.
