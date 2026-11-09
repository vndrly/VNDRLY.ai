# Shared Gate Staffing Alerts Implementation Plan

> **For agentic workers:** Use native execution with independent web/mobile/server tasks dispatched through superpowers:dispatching-parallel-agents. Preserve the user's standing uninterrupted execution authorization; no repeated approval checkpoints.

**Goal:** First-admin shared acknowledgment silences one staffing incident for everyone, with red actionable web/iOS surfaces and SMS reply support, while preserving MidCon's hold and ongoing watch custody across navigation.

**Architecture:** Persist a shift-scoped incident and map its recipient notifications. All acknowledgment and delivery channels consult that same saved state. Reuse saved Gate watch, calendar and company authority.

**Tech Stack:** TypeScript, React, Expo, Express, PostgreSQL/Drizzle; existing notification providers only.

**Spec:** docs/superpowers/specs/2026-11-09-shared-gate-staffing-alerts-design.md

## Global Constraints

- MidCon vendor1054 stays paused until John's explicit resume; no customer test sends.
- One incident per active coverage episode; first admin acknowledgment wins for everyone.
- Gate Mode navigation never ends a watch or changes permanent roles.
- Only saved actual watch coverage resolves a gap; acknowledgment and assignment do not.
- Additive guarded migration, company/site authorization, no dependencies or destructive changes.

## Review Focus

- Simultaneous admins and worker retries retain one acknowledgment winner.
- Changed/revoked membership and ambiguous SMS senders cannot acknowledge.
- Held companies get factual staffing status without alarming flyout/pulse/provider sends.
- Stale incident/notification/calendar links never mutate another shift or new episode.
- Return to Admin/Work Hub, logout or connectivity loss retains watch custody.

### Task 1: Shared server incident and lifecycle

Files: new staffing-alert service/route/schema/additive migration/tests; gate-coverage-monitor.ts; saved-watch postcommit resolution hook. Own these files exclusively.

- [ ] Write/run real DB failure cases for duplicate episodes, concurrent acknowledgments, tenant denial, held company and coverage restoration/new episode.
- [ ] Implement the exact shared interfaces in the spec; save recipient notice mapping before delivery; atomically suppress shared reminders after acknowledgment.
- [ ] Wire coverage monitor and successful saved-watch resolution; never alter existing visit workflow or permanent roles.
- [ ] Add no-op-safe additive migration entry to deployment and run meaningful DB/type checks.

### Task 2: Web flyout, Watch Radar and calendar

Files: web notification components/client, new staffing-alert hook/card, Watch Radar, existing calendar/Assume Watch links and tests. No server/mobile changes.

- [ ] Test red unacknowledged card, stopped pulse after acknowledgment, visible winner, resolved removal, hold suppression, query scoping and error retry.
- [ ] Build bell flyout/card with explanation, explicit acknowledge confirmation and direct server calendar href; reuse shared query data.
- [ ] Extend Watch Radar for active gaps and link warning/current incidents to exact calendar context, with text and reduced-motion behavior.
- [ ] Verify calendar assignment/reassignment/Assume Watch and Admin navigation preserve gate/shift context and watch. Run affected UI tests/types.

### Task 3: iOS acknowledgment and destination

Files: mobile staffing client/UI, existing notification actions/destination/calendar/watch navigation and tests. No server/web changes.

- [ ] Test first-admin shared acknowledgment via existing push action and visible iOS card; stale account scope must fail safely.
- [ ] Preserve returned exact calendar context, offer explicit acknowledgment and display shared winner/state without optimistic false success.
- [ ] Keep watch active through Admin navigation and guard held alarm surfaces. Run affected mobile tests/types.

### Task 4: Root delivery integration, SMS and release verification

Files: existing notifications route, delivery repository/Expo/event guards, new Twilio inbound router/tests, shared types. Avoid task-owned files.

- [ ] Route mapped notification acknowledgment to shared service while retaining legacy acknowledgment behavior.
- [ ] Cancel/guard queued staffing deliveries across generic and urgent channels, including claimed/retry paths, without touching unrelated notices.
- [ ] Test signed exact-code SMS, sender/consent/current admin, duplicate callbacks and opt-out/malformed/wrong-code denial; no real sends.
- [ ] Review interfaces and combined patch; run affected regression/real DB/browser checks and types; fix observed failures.
- [ ] Publish prepared release under standing authorization and verify live migrations, health and MidCon hold. Report any external provider readiness separately; never claim real phone delivery from unit tests.
