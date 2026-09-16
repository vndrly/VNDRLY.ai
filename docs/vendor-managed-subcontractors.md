# Vendor Managed Subcontractors

Vendor administrators manage external staffing companies from the vendor detail page, directly below Partner Approvals. A managed company does not need its own VNDRLY vendor registration.

## Example: Midcon Solutions and NewTech

1. Sign in with the Midcon Solutions vendor administrator membership.
2. Open the Vendor page and find **Vendor Managed Subcontractors**.
3. Create **NewTech** as a subcontractor business.
4. Select **Add worker**, enter the worker's name and email, select **Gatekeeper** or **Gate Supervisor**, and choose the permitted Midcon sites.
5. Save. The worker receives an account invitation when email delivery is available. The administrator also receives a one-time activation link to share securely; invitation delivery failures are displayed explicitly. Resending creates a new link and invalidates the previous one.
6. The worker activates their account, chooses their own password and accepts the work-participation authorization, then signs in for assigned Gate operations and permitted Midcon Work Hub content.
7. Use **Edit access** to change the role/sites, or **Revoke access** to end the assignment. Role changes and revocation invalidate existing sessions. Historical sponsorship and role records remain.

## Boundaries

- Employer remains NewTech; operational management belongs to Midcon. These workers do not create Midcon employee-payroll records.
- Only administrators in the active sponsoring vendor may manage these records. Worker access is limited by the signed account context, current sponsorship and permitted sites.
- Gate supervisors gain the applicable site-level capabilities, not company administration or payroll access.
- Private Work Hub channels require explicit membership. Task and shift visibility remains restricted to permitted work.
- Existing account emails are rejected rather than silently attaching or changing someone else's account. Account linking across existing identities is outside this initial workflow.
- No new database schema or external dependency is required. Production must already have the repository's existing managed-subcontractor and account-invitation tables.

## Development status

Implemented locally on `codex/vendor-managed-subcontractors`. The online branch contains the progress documents; full code publication is blocked by the automatic review payload limit. This document describes the feature, not a production deployment claim. Validation results and the remaining unrelated API test failure are recorded in `docs/superpowers/plans/2026-09-16-managed-subcontractors.md`.
