# Shift Hours card and future payroll

User decision, October 23, 2026:

- Payroll has not been implemented yet. Its default cadence must be **monthly**; weekly and biweekly choices will be added with payroll.
- For now, the Tasks card's collapsible Hours row uses the current calendar month and starts a new displayed total on the first. This is a date-range change, never deletion or clearing of shift history.
- List the current worker's recorded shifts, actual hours for each within the period, unpaid breaks excluded, and an explicitly running total for open shifts. Each shift links to its local day in Work Hub Calendar.

When payroll is implemented:

- Move the displayed period boundary to an employer- and worker-scoped backend function. Payroll processing must advance the applicable processed-through boundary; the card must not assume a calendar rollover means payroll was processed.
- Monthly remains the default payroll cadence. Support weekly/biweekly/custom periods through the actual payroll configuration.
- Return authoritative period start/end and the last processed payroll reference to the Hours card. Keep recorded work, office adjustments, and payroll-approved hours distinct.
- Processing payroll must be auditable and idempotent. Preserve all original clock events and prior periods so they remain available in the calendar and history.

Current entry points: `artifacts/vndrly/src/lib/dashboard-shift-hours.ts` (`monthlyShiftHoursRange`, `readDashboardShiftHours`), `artifacts/vndrly/src/components/work-hub/dashboard-shift-hours.tsx`, and the existing `/api/work-hub/workday/workers/:workerUserId` clock-history API. No payroll-processing operation or payroll reset has been added at this stage.
