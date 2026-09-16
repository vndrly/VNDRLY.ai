# Managed Subcontractor Hours Implementation Plan

1. Add guarded relationship-level approval-policy and report-recipient columns.
2. Calculate scheduled and accrued hours from Work Hub shifts and field trips, with audited corrections and approval snapshots.
3. Add supervisor-scoped read, approve, correct, PDF, email, and settings endpoints.
4. Grant Gate Supervisors site-scoped meeting-host authority alongside existing scheduling and communication access.
5. Add Vendor-card and Calendar report panels using branded action pills.
6. Run migration safety, focused API/web, typecheck, locale, full test, and build gates.
7. Commit, advance `main`, deploy web/API/migration/OTA, submit TestFlight, and verify public health.
