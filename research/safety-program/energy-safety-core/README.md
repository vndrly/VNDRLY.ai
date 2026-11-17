# VNDRLY Energy Safety Core

Current work is **not accepted complete** under the 115-program instruction. The existing English onshore course contains ten teaching chapters, 22 worked scenarios, 61 explained learning checks and a separate 40-question examination drawn from a 75-item server-only bank. These counts describe artifacts, not educational sufficiency.

The version 3 development revision adds a program/delivery guide with an integrated field exercise and a six-station application packet with observable criteria, retry scenarios, and a record form. The guide is the twelfth required learning section; the application packet is supplemental and does not impose a universal live-equipment evaluation on orientation learners. Earlier approved credential versions remain compatible. The persisted synthetic learner workflow has passed; publication, full app presentation checks, and the remaining source review are separate unfinished work tracked in `../certifications-115/completion-ledger.json`.

This is a VNDRLY internal knowledge credential. No PEC, SafeLandUSA, SafeGulf, IADC, OSHA Outreach, H2S Clear, independent accreditation or operator acceptance is claimed. External-equivalence review is a VNDRLY management matter. Only duties required by a cited regulation for the actual work role are retained; no universal practical test, evidence upload or independent assessor is required for online completion.

Learning records preserve original answers and acknowledged remediation. The separate examination is unlocked only after learning completion. It draws four questions per domain, saves answers, withholds answer keys/explanations until explicit submission, preserves failed attempts, and permits a fresh randomized retake. It is account-authenticated and unproctored. The user's passed G99 result is bound to the exact source hash/version and has a private own-user credential projection across company changes; employer operational or private records do not transfer through that projection.

## Source artifacts and reproduction

- `lessons-a.json`, `lessons-b.json`: full original lessons, cases and initial checks, including primary sources.
- `additional-checks.mjs`: 21 additional explained checks for coverage gaps identified during internal author review.
- `assessment-contract.json`, `assessment-index.json`: counts, release hashes and objective-linked item identifiers only. Active exam questions and answer keys are not in public source. Earlier draft questions published during development are retired and are not the active bank.
- `benchmark-crosswalk.json`: real lesson headings and paragraph hashes, formative items and separate exam items for each of 42 published benchmark objectives. Author mapping; independent review remains open.
- `osha-crosswalk.json`: applicability, knowledge level and exact remaining employer/practical evidence, not blanket compliance checkmarks.
- `independent-review-register.json`: nine explicit external/qualified-review/acceptance work items.

Run `node scripts/build-task-training-release.mjs` to reproduce the unchanged 116-course baseline plus the flagship public teaching/registry, or `node scripts/build-energy-safety-core.mjs` when the baseline manifest exists. `course.json` and `publication.json` contain teaching content, never the active exam bank. An authorized private bank and objective map under `.local/private-training/` are required to change the assessment or create the complete server publication payload. A public checkout can reproduce unchanged teaching and registry hashes from the recorded release contract without access to questions or keys.

Use `node scripts/publish-streamlined-training.mjs --validate-only` for the current revision; it does no database access. Default mode is a read-only production preflight. `--apply` adds current versions in the existing Library series, retains approved prior completion credit and carries policies without creating assignments or changing scoring rules. The original G99 publisher is a historical version-1 entry point. Live publication and verification are recorded separately.
