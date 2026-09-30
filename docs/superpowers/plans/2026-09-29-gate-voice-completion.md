# Gate voice completion implementation plan

**Goal:** Complete gate check-in and check-out reliably from spoken or manual input, and reuse the branded round arrow for AskV Send.

**Architecture:** Extend the existing gate form, voice transcript processing, assistant client intents, and canonical visits API. Keep one visible draft per active gate surface; preserve server authorization, location checks and idempotency. No new dependencies or parallel visits system.

**Tech stack:** Existing React/React Native, TypeScript, Express, Vitest and Playwright.

**Spec:** `docs/next-release.md`; approved for implementation and full ship after the dark-mode/header release.

## Constraints and review focus

- Preserve other working-tree changes, credentials, live data and all gate prerequisites.
- Partial speech and manual corrections must not drift into different drafts.
- Repeated commands and transport retries must not duplicate visits.
- New-truck/cancel commands must not carry the preceding driver's data forward.
- Ambiguous history or checkout matches require resolution, never guessing.
- Report saved only after persistence; retain the draft on failure.

## Tasks

1. **Send control** — extend `sphere-back-button.tsx` with an arrow direction, preserving its hover chrome; use it for AskV send controls. Verify existing submit/loading/disabled behavior and keyboard label.
2. **Gate transcript interpretation** — strengthen existing web/mobile `gate-voice-entry.ts` parsers for completion, cancellation, corrections, spelled plates and the approved one-shot example. Add regression tests that fail before changes.
3. **Shared form execution** — update web `pages/gatekeeper.tsx` and mobile `app/(tabs)/gate.tsx` to apply speech to their current form before submitting, support manual/voice combinations, protect in-flight saves, and clear only after success. Exercise consecutive trucks and failed retries in screen tests.
4. **AskV integration** — inspect and repair existing realtime/text client intent and server gate intent boundaries so current gate form facts are available, completion phrases execute only with actual user authorization, and successful mutations clear the matching draft. Verify ambiguity, corrections and denied actions.
5. **Release proof** — run focused tests, required workspace gates and isolated API/browser verification; review changes, commit/publish non-force, deploy web/API/guarded migrations, publish compatible OTA, build and submit TestFlight. Record actual voice/device limitations separately from automated proof.

## Execution ledger

- First release completed through TestFlight submission and compatible OTA before this implementation starts.
- Implementation proceeds in this session under the user's explicit full authorization; no new approval checkpoint is required for the already approved design or release.
- Initial finding: local web gate transcript handling fills fields but does not execute a spoken submit, and rejects standalone submit when no new fields are parsed. The assistant and form also need explicit draft synchronization.
