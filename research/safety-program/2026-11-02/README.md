# Task-specific training and remaining qualification evidence

This batch adds 47 original, complete knowledge courses to the existing 69-course VNDRLY curriculum. Each contains six written lessons, two worked fictional cases, six lesson checks and twenty final questions. Original responses remain recorded alongside explicitly acknowledged remediation. Knowledge completion does not establish unobserved practical competence or authorize work.

The 49 domain groups come from the consolidated source-backed gap register. Two groups do not justify a universal course: TG17 requires the actual professional duty and jurisdiction, and TG45 requires the actual equipment, method or transport mode. TG45 retains 21 individual service clarifications rather than assigning unrelated specialist qualifications to every service.

## Review in VNDRLY

Open `/safety-score`, expand **Task-specific courses and remaining evidence**, and search the service. Each entry names the affected roles, links the company's published course and lists vendor records and qualified practical evaluations still required. The same requirements appear at the beginning and end of each new course.

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

`node scripts/publish-task-training.mjs --validate-only` performs no database queries. The default command performs a read-only production preflight. `--apply` adds deterministic course versions and audit records in guarded per-company transactions; it never updates/deletes existing templates, policies, assignments or completions. Publication requires the matching API registry and exact manifest. Live publication and learner verification evidence are recorded separately; this source file does not assert an individual worker's qualification.
