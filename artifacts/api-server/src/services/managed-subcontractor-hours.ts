export type HoursApprovalPolicy = "contractor" | "subcontractor" | "either" | "dual";

type ApprovalState = { contractor: boolean; subcontractor: boolean };
type ShiftInput = { id: string; userId: number; workerName: string; siteName: string; startsAt: string; endsAt: string };
type TripInput = { shiftId: string | null; userId: number; startedAt: string; completedAt: string | null };
type CorrectionInput = { shiftId: string; userId: number; actualStart: string; actualEnd: string; reason: string; correctedByUserId: number; correctedAt: string };

export function approvalSatisfied(policy: HoursApprovalPolicy, approvals: ApprovalState): boolean {
  if (policy === "contractor") return approvals.contractor;
  if (policy === "subcontractor") return approvals.subcontractor;
  if (policy === "dual") return approvals.contractor && approvals.subcontractor;
  return approvals.contractor || approvals.subcontractor;
}

function minutes(start: string, end: string): number | null {
  const value = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function buildManagedSubcontractorHoursReport(input: {
  organization: { id: string; name: string };
  sponsor: { id: number; name: string };
  approvalPolicy: HoursApprovalPolicy;
  approvals: ApprovalState;
  range: { start: string; end: string };
  shifts: ShiftInput[];
  trips: TripInput[];
  corrections?: CorrectionInput[];
}) {
  const approved = approvalSatisfied(input.approvalPolicy, input.approvals);
  const lines = input.shifts.map((shift) => {
    const correction = input.corrections?.find((row) => row.shiftId === shift.id && row.userId === shift.userId);
    const tripRows = input.trips.filter((row) => row.shiftId === shift.id && row.userId === shift.userId);
    let actualStart: string | null = correction?.actualStart ?? null;
    let actualEnd: string | null = correction?.actualEnd ?? null;
    let source: "correction" | "field_work" | "missing" = correction ? "correction" : "missing";
    if (!correction && tripRows.length) {
      actualStart = tripRows.map((row) => row.startedAt).sort()[0] ?? null;
      const completions = tripRows.flatMap((row) => row.completedAt ? [row.completedAt] : []).sort();
      actualEnd = completions.at(-1) ?? null;
      source = "field_work";
    }
    const scheduledMinutes = minutes(shift.startsAt, shift.endsAt) ?? 0;
    const actualMinutes = actualStart && actualEnd ? minutes(actualStart, actualEnd) : null;
    const exceptions: string[] = [];
    if (!actualStart && !actualEnd) exceptions.push("missing_actual");
    else if (!actualStart || !actualEnd) exceptions.push("incomplete_actual");
    else if (actualMinutes === null) exceptions.push("invalid_actual");
    return {
      shiftId: shift.id,
      userId: shift.userId,
      workerName: shift.workerName,
      siteName: shift.siteName,
      scheduledStart: shift.startsAt,
      scheduledEnd: shift.endsAt,
      actualStart,
      actualEnd,
      scheduledMinutes,
      actualMinutes,
      approvedMinutes: approved && !exceptions.length ? actualMinutes : null,
      source,
      correction: correction ?? null,
      exceptions,
    };
  });
  return {
    title: "Approved Hours Report",
    organization: input.organization,
    sponsor: input.sponsor,
    approvalPolicy: input.approvalPolicy,
    approvals: input.approvals,
    approved,
    range: input.range,
    lines,
    totals: lines.reduce((sum, line) => ({
      scheduledMinutes: sum.scheduledMinutes + line.scheduledMinutes,
      actualMinutes: sum.actualMinutes + (line.actualMinutes ?? 0),
      approvedMinutes: sum.approvedMinutes + (line.approvedMinutes ?? 0),
    }), { scheduledMinutes: 0, actualMinutes: 0, approvedMinutes: 0 }),
  };
}

export type ManagedSubcontractorHoursReport = ReturnType<typeof buildManagedSubcontractorHoursReport>;
