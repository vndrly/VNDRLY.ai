# Managed Subcontractor Hours and Supervisor Access

## Outcome

VNDRLY sponsors managed subcontractors without treating their people as the sponsor's employees. Midcon and NewTech share the Midcon Work Hub for assigned work while NewTech remains the employer. Operational roles are assigned per worker and per site.

## Roles and collaboration

- Managed workers may be Gatekeepers or Gate Supervisors at selected sponsor sites.
- Gate Supervisors may schedule shifts, assign tasks, use scoped chat/calls, and host meetings within their permitted gate/site context.
- Permissions do not grant vendor-wide office or policy administration.

## Hours model

- Scheduled hours come from Work Hub shifts and assignments.
- Accrued hours come from completed, shift-linked field work sessions.
- Missing or incomplete field work is flagged for supervisor review.
- A supervisor correction records the reason, author, and timestamp and clears prior approvals.
- Each sponsor/subcontractor relationship selects one approval rule: contractor, subcontractor, either supervisor, or both supervisors.
- Approved snapshots are stored as `approved_hours_report` Work Hub finance records; no wage, tax, or payroll calculation is performed.

## User surfaces

- Vendor Managed Subcontractors shows each company's scheduled, accrued, and approved totals, approval settings, recipient list, Email Hours Report, and Download PDF.
- Work Hub Calendar shows the same report below the selected day's schedule for contractor and subcontractor supervisors.
- Reports are branded operational documents that NewTech can use outside VNDRLY.

## Safety and isolation

- All queries remain scoped to the sponsoring vendor and managed organization.
- Managed supervisors see only relationships and site work they are authorized to access.
- The database migration is additive and idempotent.
