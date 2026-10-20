# Task 11 — Fleet supporting mobile modules

## Delivered

- Replaced the Compliance module's register-first landing view with a role-authorized VNDRLY score helper. It shows red/amber/green status, category scores, ranked deductions, estimated gains, remediation, responsible role, due dates, score history, and the Partner-facing preview before linking to detailed evidence registers.
- Kept low scores explicitly advisory and non-blocking. A genuine score-service outage has a separate alert and retry action while Dispatch, Runs, and tickets remain available.
- Added searchable recorded-run history and explicit VNDRLY driver-phone source, capture time, and freshness confidence to Fleet Map rows. The server's existing role-scoped projection remains authoritative, so the client does not widen Office, Yard, or Driver visibility.
- Updated mobile and web Partner vendor cards to label the VNDRLY safety/compliance score, show semantic red/amber/green status, retain source/freshness, and state that Partners—not VNDRLY—set hiring policy.
- Added matching English/Spanish copy and corrected the existing Fleet language test to use its localized Map label and a complete authorized setup context.

## Verification

- Mobile supporting suites: 7 files, 50 tests passed.
- Web Partner marketplace: 16 tests passed.
- Mobile typecheck passed.
- EN/ES locale parity passed for mobile and web.
- `git diff --check` passed.

## Boundaries

- No compliance deficiency blocks Yard, Dispatch, Run, ticket, or billing flow.
- No third-party telematics or compliance provider was added; the marketplace score remains sourced from existing VNDRLY partner-scoped safety events.
- No database migration or external dependency was introduced.
