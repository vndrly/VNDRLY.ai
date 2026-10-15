# Company Safety Readiness Implementation Plan

**Goal:** Show organization-wide safety readiness and actual actions, weighted 60/40 with incidents.
**Architecture:** Existing record adapters feed a pure six-category evaluator. A membership-authorized read endpoint returns aggregates and coverage. Native/web surfaces render the same assessment; existing permission-checked Library and certification workflows handle mutations.
**Spec:** ../specs/2026-10-14-company-safety-readiness.md
**Constraints:** No invented requirements or responses, no new dependencies, no destructive SQL. Unknown evidence is provisional, not compliant.

- [ ] Pure evaluator and tests: 60/40 calculation, unknown coverage, duplicate denominator handling, zero requirements, expired refreshers, completion evidence.
- [ ] Scoped data adapter and API: current membership only, active roster, published explicitly tagged safety requirements, actual completions, verified credentials, corrective actions, honest unsupported-source coverage.
- [ ] Shared Library safety requirement flag, native/web editor and labels. Preserve immutable version behavior.
- [ ] Company assessment UI and dashboard links, replace personal section, aggregate counts and action destinations. AskV parity uses canonical assessment.
- [ ] Verify focused tests/typechecks/locale parity, scoped integration on isolated database, publish through authorized release lanes and report remaining evidence limits.
