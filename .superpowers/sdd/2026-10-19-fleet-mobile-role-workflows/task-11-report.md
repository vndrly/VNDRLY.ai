# Task 11 — Fleet supporting mobile modules

## Delivered

- Replaced the Compliance module's register-first landing view with a role-authorized VNDRLY score helper. It shows red/amber/green status, category scores, ranked deductions, estimated gains, remediation, responsible role, due dates, score history, and the Partner-facing preview before linking to detailed evidence registers.
- Kept low scores explicitly advisory and non-blocking. A genuine score-service outage has a separate alert and retry action while Dispatch, Runs, and tickets remain available.
- Added searchable recorded-run history and explicit VNDRLY driver-phone source, capture time, and freshness confidence to Fleet Map rows. The server's existing role-scoped projection remains authoritative, so the client does not widen Office, Yard, or Driver visibility.
- Updated mobile and web Partner vendor cards to label the VNDRLY safety/compliance score, show semantic red/amber/green status, retain source/freshness, and state that Partners—not VNDRLY—set hiring policy.
- Added matching English/Spanish copy and corrected the existing Fleet language test to use its localized Map label and a complete authorized setup context.
- Unified the vendor helper and both Partner marketplace cards on the same persisted VNDRLY compliance-score preview. The separate Partner-scoped safety-event metric remains distinct and is no longer presented as the company compliance score.
- Persisted one company score snapshot per UTC day in the existing guarded vendor configuration, retaining the newest 365 snapshots and exposing only stable reason codes to Partner clients.
- Added advisory red/amber/green company markers to Fleet Map while keeping location-source and freshness indicators separate, and replaced hand-built dots/emoji with semantic shared pill components.
- Replaced server-authored display text with stable reason/remediation codes mapped by EN/ES clients, including localized accessibility labels.
- Replaced the temporary public-index shortcut with the full canonical compliance evaluator for both Fleet and Partner projections. Private evidence, requirements, applicability facts, coverage scope/limits, filing review, and generic-insurance review remain server-side; Partner clients receive only the privacy-safe score and reason codes. Partner reads reevaluate current evidence, so expiry and evidence changes do not require a vendor page visit.

## Verification

- Mobile supporting suites: 7 files, 50 tests passed.
- Web Partner marketplace: 16 tests passed.
- Mobile typecheck passed.
- EN/ES locale parity passed for mobile and web.
- `git diff --check` passed.
- Focused API score/marketplace suites: 3 files, 21 tests passed.
- Focused mobile helper/map/marketplace/language suites: 4 files, 28 tests passed.
- API Zod workflow suite: 8 tests passed; web Partner marketplace: 16 tests passed.
- Library, API, mobile, and web typechecks passed; EN/ES locale parity passed.
- Final canonical-projection regression batch: 3 API files, 23 tests passed; API typecheck and diff check passed.

## Boundaries

- No compliance deficiency blocks Yard, Dispatch, Run, ticket, or billing flow.
- No third-party telematics or compliance provider was added; the company compliance score is sourced from VNDRLY's canonical requirements/facts/evidence evaluator. The separate Partner-scoped safety-event metric remains distinct.
- No database migration or external dependency was introduced; history and the privacy-safe Partner preview use the existing vendor configuration JSON.
