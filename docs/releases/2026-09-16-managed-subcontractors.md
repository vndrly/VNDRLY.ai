# Vendor Managed Subcontractors release — September 16, 2026

## Release identity

- Application source: `9fe07a3960d0c67c5872ecd2c3da9f2e136cd3ab`.
- Implementation: `62b412a089dc9930c2bfb5a33c9a0bcd41cd14df`.
- Full production release explicitly authorized by the user.
- GitHub `main` and local `main` advanced without force or destructive cleanup.

## Deployment evidence

| Track | Evidence | State |
| --- | --- | --- |
| Web | [Publish 35095982377](https://github.com/vndrly/VNDRLY.ai/actions/runs/35095982377) | Success |
| API and guarded migrations | [Deploy API 35095982323](https://github.com/vndrly/VNDRLY.ai/actions/runs/35095982323) | Success |
| iOS production update | [OTA 35095995450](https://github.com/vndrly/VNDRLY.ai/actions/runs/35095995450) | Success |
| Native iOS and submission | [TestFlight 35095990888](https://github.com/vndrly/VNDRLY.ai/actions/runs/35095990888) | Success; Apple internal beta available |
| Independent verification | [Verify release 35095961033](https://github.com/vndrly/VNDRLY.ai/actions/runs/35095961033) | Full required chain passed; earlier independent API pass exposed a test-isolation flake, corrected in follow-up |

Web/API public verification completed at `2026-09-16T12:29:36Z`, approximately 1 minute 57 seconds after the final release commit. `/`, `/gate`, and `/api/healthz` returned HTTP 200. The repository production smoke script passed all checks. Anonymous invalid-token activation returned HTTP 200 with state `invalid` and `Cache-Control: no-store`. Public vendor-page asset `vendor-detail-C5-2UQeD.js` contains the managed-subcontractor endpoint integration.

No new schema migration was required for this feature. Deployment ran the existing guarded migrations, including implementation-A, successfully. No production records, passwords, or storage assets were reset.

## Mobile identifiers

- OTA branch: `production`; runtime: `1.0.2`.
- OTA group: `39868884-6784-4952-b5c0-7e874e72feba`.
- Native app: `1.0.2`, build `177`.
- EAS build: `2587bcf5-b427-4c8a-ad23-ae4480f8ad9d`, verified `FINISHED`, exact release source, production STORE iOS IPA.
- Submission: `8f853acc-52f5-4312-ad01-6b8bca4bc683`, `FINISHED`, no error.
- Apple build: `b94af9ac-2704-4e53-b2d5-5b373e42b85d`, processing `VALID`, internal state `IN_BETA_TESTING`, external state `READY_FOR_BETA_SUBMISSION`.

## Functional verification

The isolated browser flow passed company creation, worker invitation, anonymous account activation, worker Gate and Work Hub access, role change, stale-session rejection, revocation and preserved history. The complete rerun passed 15 tests. Final affected API verification passed 69 tests across 13 suites. CI's complete required chain on the exact application release passed 2,981 API tests (53 skipped), 1,189 web tests (3 skipped), 994 mobile tests, shared-library suites, and all 42 browser tests. Typecheck and locale parity passed. The OTA workflow independently passed all 994 mobile tests.

The earlier independent API pass failed one demo-seed test: unrelated fixture cleanup decreased global table counts between snapshots. The subsequent full API pass on unchanged source succeeded. The follow-up test-only correction snapshots canonical seed-owned identities, memberships and organization row IDs, retaining exact-count, duplicate and replacement assertions without relying on unrelated rows. It does not change demo passwords, production data, or application behavior.

The existing Midcon browser session required sign-in after deployment. Account-specific visual verification is pending the user restoring that session. No sample company or worker was inserted into production.

## Resume

Read this record and `docs/superpowers/plans/2026-09-16-managed-subcontractors.md`. All deployment tracks completed for the application source above. The follow-up contains only test isolation and release documentation; the installed application remains build 177 from the exact source recorded here. No duplicate native build is needed for unchanged application code.
