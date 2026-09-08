# Work Hub release evidence

Date: 2026-09-08

## Included

- Guarded additive Work Hub flags and collaboration, work, schedule, meeting, connector, search, notification, retention, and audit schema.
- Context-capability authorization, opaque cross-tenant failures, idempotent commands, version conflicts, private files, SSE events, notification preferences, search, and personal Home aggregation.
- Focused web and iOS navigation with a reliable return to the main VNDRLY experience.
- One shared web/iOS AskV Work Hub toolbox; consequential writes use the existing confirmation and audit path.
- Public commercial homepage and a separate curated public AskV boundary with no authenticated tools or history.
- API deployment runs all Work Hub migrations in order.

## Verification on the release tree

- `pnpm lint:i18n`: pass (web 4,399 keys per locale; mobile 1,751 keys per locale).
- `pnpm run typecheck`: pass.
- `pnpm run test:web`: pass (138 files, 937 passed, 1 skipped).
- Mobile Vitest: pass (100 files, 673 passed).
- `pnpm run test:api`: pass (269 files passed, 16 skipped; 2,265 tests passed, 108 skipped) against isolated `postgres_test` with a non-routable test AI endpoint.
- Flags, core, domains, and notification migrations each passed two consecutive applications against `postgres_test`.

## Controlled rollout and known external work

- Work Hub remains false-default and can be rolled back by flag without reverting schema.
- Audio meetings are safe-disabled. Provider approval, credentials, data-processing review, signed webhooks, and physical iPhone/iPad audio-route testing remain before recording or transcription can be enabled. See `docs/decisions/work-hub-audio-provider.md`.
- Microsoft 365 is read-only by contract and safe-disabled. Azure registration, OAuth credentials, callback verification, and selected-calendar sync remain before enablement.

## Production completion fields

- Release commit:
- GitHub main:
- Web Publish:
- API Deploy and `/api/healthz`:
- Supabase migrations/storage:
- Expo OTA update group:
- TestFlight build/submission:
- Commit-to-public-web elapsed time:
