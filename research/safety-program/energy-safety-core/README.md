# VNDRLY Energy Safety Core

Finished original English onshore safety knowledge course: ten substantive chapters, 22 worked scenarios, 48 explained learning checks and a separate 40-question domain-balanced examination from a 74-item bank. Four additional sections contain learner instructions, the actual 42-objective Basic Orientation 7.0 crosswalk, the 68-row OSHA/applicability evidence register and nine open independent-review/acceptance items.

This is VNDRLY internal knowledge evidence. No PEC, SafeLandUSA, SafeGulf, IADC, OSHA Outreach, H2S Clear, independent accreditation or operator acceptance is claimed. Self-paced study duration and the provisional 80-percent exam threshold require independent validation. Actual employer procedures, practical demonstrations, medical/fit requirements and jurisdiction-specific duties remain open as identified in the course. Passing an online exam does not establish those qualifications.

Learning records preserve original answers and acknowledged remediation. The separate examination is unlocked only after learning completion. It draws four questions per domain, saves answers, withholds answer keys/explanations until explicit submission, preserves failed attempts, and permits a fresh randomized retake. It is account-authenticated and unproctored. The user's passed G99 result is bound to the exact source hash/version and has a private own-user credential projection across company changes; employer operational or private records do not transfer through that projection.

## Source artifacts and reproduction

- `lessons-a.json`, `lessons-b.json`: full original lessons, cases and initial checks, including primary sources.
- `additional-checks.mjs`: eight additional explained checks for coverage gaps identified during internal author review.
- `exam-bank.mjs`: original separate assessment bank with server-only keys and explanations.
- `benchmark-crosswalk.json`: real lesson headings and paragraph hashes, formative items and separate exam items for each of 42 published benchmark objectives. Author mapping; independent review remains open.
- `osha-crosswalk.json`: applicability, knowledge level and exact remaining employer/practical evidence, not blanket compliance checkmarks.
- `independent-review-register.json`: nine explicit external/qualified-review/acceptance work items.

Run `node scripts/build-task-training-release.mjs` to reproduce the unchanged 116-course baseline plus the flagship, or `node scripts/build-energy-safety-core.mjs` when the baseline manifest exists. `course.json`, `publication.json` and `validation.json` are deterministic generated outputs and are committed for review/publication verification.

`node scripts/publish-energy-safety-core.mjs --validate-only` does no database access. Default mode is a read-only production preflight. `--apply` adds one deterministic G99 course and audit to each existing company Library in a guarded transaction. It neither changes prior templates nor creates assignments, policies or scoring rules. Readback and prior-template fingerprints are recorded in a local checkpoint. This source document does not assert deployment; live verification is recorded separately.
