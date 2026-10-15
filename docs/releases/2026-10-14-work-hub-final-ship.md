# Work Hub final ship - October 14, 2026

Includes company safety readiness (60/40), unified newest-assigned My Work, retired QR ticket starts and PTT navigation, branded crew activity, web/AskV/plugin parity, and reviewed main-checkout demo isolation/connection work.

## Verification
- Workspace typecheck and locale parity passed.
- Web broad run: 1607 passed; retired Scan label failure fixed; affected 8 tests passed.
- Mobile broad run: 1857 passed; retired label failure fixed; affected 9 tests and earlier 37 navigation/feed tests passed.
- API broad run: 4948 passed, 64 skipped. Initial transmitter hook timeout passed in focused 218-test run. Two helper exports were cached before the final edit; fresh six-test run passed. Latest company integration, scoped tickets, and workspace tests: 51 passed.
- Browser E2E: 44 passed, including two-user internal audio.
- Demo realm/config tests: six passed. Plugin 1.15.0 package check passed.
- Independent review corrected membership scoping, future-issued credentials, and latest-equipment inspection matching.

## Unsaved work audit
Main-checkout tracked patch integrated using three-way merge; newer released security and authorization implementations retained where older main fragments were superseded. Main checkout remains preserved. Historical untracked maintenance helpers included as source, never executed as a release step. No destructive database operation authorized or performed. Synthetic database checks used fresh UUID local databases only.

## Release lanes
Publication, guarded production API migrations, web, OTA, TestFlight, and existing installed plugin verification are tracked externally after this exact tree is published. Previous build 220 was submitted; this release requires its own native submission. Public plugin status remains DEVELOPMENT pending approval. MidCon policy text remains unpublished until supplied.
