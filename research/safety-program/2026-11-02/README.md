# Task-specific training and remaining qualification evidence

This batch adds 47 original, complete knowledge courses to the existing 69-course VNDRLY curriculum. Each contains six written lessons, two worked fictional cases, six lesson checks and twenty final questions. Original responses remain recorded alongside explicitly acknowledged remediation. Knowledge completion does not establish unobserved practical competence or authorize work.

The 49 domain groups come from the consolidated source-backed gap register. Two groups do not justify a universal course: TG17 requires the actual professional duty and jurisdiction, and TG45 requires the actual equipment, method or transport mode. TG45 retains 21 individual service clarifications rather than assigning unrelated specialist qualifications to every service.

## Review in VNDRLY

Open `/safety-score`, expand **Task-specific courses and applicable legal requirements**, and search the service. Each entry names the affected roles and links the company's published course. Version 2 removes automatic vendor-evidence and practical-assessment lists. Any retained task duty names its regulation, the actual covered role and its source; it is not an added online-course completion requirement.

The existing H2S service remains a separate, source-backed extension. No master-catalog identifier was invented. Its six roles retain distinct evidence requirements. G71 calibration knowledge connects to actual detector calibration/repair duties, with person/position exposure confirmation; it is not required of every H2S worker. Online completion does not close model-specific service instruction, medical/fit arrangements, rescue capability or gas-testing authorization.

## Authoritative artifacts

- `task-courses/G*.json`: complete original teaching and assessments.
- `task-courses/TG45-residual-scope.json`: service-specific unresolved questions and source context.
- `remaining-evidence-register.json`: domain/role/service residuals; no specialist qualification is marked closed by online completion.
- `h2s-remaining-evidence.json`: six distinct existing H2S service roles.
- `additional-course-service-rules.json`: exact service associations and reviewed role/exposure conditions.
- `preserved-course-identities.json`: unchanged identities for all 69 previously published courses.

## Reproduction and additive publication

From the repository root with its existing dependencies, run `node scripts/build-task-training-release.mjs`. It validates teaching structure, rejects bulk repeated prose, verifies the preserved course identities, prepares the publication manifest and generates the API catalog. The prepared manifest is generated output.

For the current streamlined revision, use `node scripts/publish-streamlined-training.mjs --validate-only`; this performs no database queries. Default mode is a read-only production preflight. `--apply` adds current course versions and audits in guarded company transactions, retains approved earlier completion credit, and carries policies without creating repeat assignments. The original task-course publisher is historical. Publication requires matching canonical hashes; live verification is recorded separately.
