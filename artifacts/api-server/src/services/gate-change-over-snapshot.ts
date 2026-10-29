import { createHash } from "node:crypto";

export interface ShiftRecord {
  id: string;
  kind: "visitor" | "employee";
  name: string;
  company: string | null;
  plate: string | null;
  checkIn: string;
  checkOut: string | null;
  admission: string | null;
  expectedMinutes: number | null;
  reconciliation: string | null;
  notes: string | null;
}
export interface ShiftItem {
  id: string;
  text: string;
  status: string;
}
export interface ShiftFact {
  id: string;
  text: string;
}

export function assembleShiftSnapshot(
  records: ShiftRecord[],
  items: ShiftItem[],
  startedAt: string,
  at = new Date(),
) {
  const start = new Date(startedAt).getTime();
  const end = at.getTime();
  const ordered = [...records].sort((a, b) => a.id.localeCompare(b.id));
  const admitted = ordered.filter(
    (r) =>
      !["pending", "denied", "rejected"].includes(r.admission ?? "") &&
      Date.parse(r.checkIn) <= end,
  );
  const outstanding = admitted.filter(
    (r) =>
      r.reconciliation !== "confirmed_off_site" &&
      (!r.checkOut || Date.parse(r.checkOut) > end),
  );
  const inWindow = (value: string | null) =>
    value != null && Date.parse(value) >= start && Date.parse(value) <= end;
  const newest = [...ordered].sort((a, b) => Date.parse(b.checkIn) - Date.parse(a.checkIn));
  const admittedRows = new Set(admitted), outstandingRows = new Set(outstanding);
  const vehiclePlates = new Set<string>();
  const vehicles = [...outstanding].sort((a, b) => Date.parse(b.checkIn) - Date.parse(a.checkIn)).filter(row => {
    const plate = row.plate?.trim().toUpperCase();
    if (!plate || vehiclePlates.has(plate)) return false;
    vehiclePlates.add(plate); return true;
  });
  const groups = {
    checkIns: newest.filter(r => admittedRows.has(r) && inWindow(r.checkIn)),
    checkOuts: admitted.filter(r => inWindow(r.checkOut)).sort((a, b) => Date.parse(b.checkOut!) - Date.parse(a.checkOut!)),
    onSiteVisitorRecords: newest.filter(r => outstandingRows.has(r) && r.kind === "visitor"),
    onSiteEmployeeRecords: newest.filter(r => outstandingRows.has(r) && r.kind === "employee"),
    onSiteVehicles: vehicles,
    pendingAdmission: newest.filter(r => r.admission === "pending" && !r.checkOut),
  };
  const metricRecordIds = Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.map(row => row.id)]));
  const metrics = {
    checkIns: groups.checkIns.length,
    checkOuts: groups.checkOuts.length,
    onSiteVisitorRecords: groups.onSiteVisitorRecords.length,
    onSiteEmployeeRecords: groups.onSiteEmployeeRecords.length,
    onSiteVehicles: groups.onSiteVehicles.length,
    pendingAdmission: groups.pendingAdmission.length,
  };
  const exceptions = ordered.flatMap((r) => {
    const result: { sourceId: string; code: string; text: string }[] = [];
    if (!r.name.trim())
      result.push({
        sourceId: r.id,
        code: "missing_identity",
        text: `${r.id}: visitor name is missing.`,
      });
    if (
      r.reconciliation &&
      !["not_required", "reconciled", "complete"].includes(r.reconciliation)
    )
      result.push({
        sourceId: r.id,
        code: "reconciliation",
        text: `${r.id}: reconciliation status is ${r.reconciliation}.`,
      });
    if (
      outstandingRows.has(r) &&
      end - Date.parse(r.checkIn) > (r.expectedMinutes ?? 720) * 60000
    )
      result.push({
        sourceId: r.id,
        code: "overdue",
        text: `${r.id}: still on site beyond ${r.expectedMinutes == null ? "12 hours (review threshold)" : `the recorded ${r.expectedMinutes}-minute expected visit`}.`,
      });
    if (r.checkOut && Date.parse(r.checkOut) < Date.parse(r.checkIn))
      result.push({
        sourceId: r.id,
        code: "invalid_time",
        text: `${r.id}: checkout precedes check-in.`,
      });
    return result;
  });
  const openItems = [...items]
    .filter((i) => i.status === "open")
    .sort((a, b) => a.id.localeCompare(b.id));
  const facts: ShiftFact[] = [
    {
      id: "metrics:events",
      text: `${metrics.checkIns} check-in records and ${metrics.checkOuts} check-out records during this shift.`,
    },
    {
      id: "metrics:occupancy",
      text: `${metrics.onSiteVisitorRecords} visitor records, ${metrics.onSiteEmployeeRecords} employee records and ${metrics.onSiteVehicles} distinct recorded vehicle plates remain on site.`,
    },
    {
      id: "metrics:pending",
      text: `${metrics.pendingAdmission} admission requests are pending.`,
    },
    ...exceptions.map((e) => ({ id: `${e.sourceId}:${e.code}`, text: e.text })),
    ...openItems.map((i) => ({
      id: `item:${i.id}`,
      text: `Carry forward: ${i.text}`,
    })),
  ];
  // Exclude generated time and elapsed durations. Any source correction, event
  // or item state change invalidates acknowledgment, independent of row order.
  const revision = createHash("sha256")
    .update(
      JSON.stringify({
        startedAt,
        records: ordered,
        items: [...items].sort((a, b) => a.id.localeCompare(b.id)),
      }),
    )
    .digest("hex");
  return {
    generatedAt: at.toISOString(),
    startedAt,
    revision,
    metrics,
    records: newest,
    metricRecordIds,
    outstanding,
    exceptions,
    openItems,
    taskItems: [...items].sort((a, b) => a.id.localeCompare(b.id)),
    facts,
    coverage:
      "site-wide records across all gates; visitor and employee records can refer to the same person; vehicle count uses recorded plates only",
  };
}
export type ShiftSnapshot = ReturnType<typeof assembleShiftSnapshot>;

/** AI may select/order facts; it cannot author operational assertions. */
export function groundedSummary(
  facts: ShiftFact[],
  ids: unknown,
): ShiftFact[] | null {
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 12 ||
    ids.some((id) => typeof id !== "string")
  )
    return null;
  const byId = new Map(facts.map((f) => [f.id, f]));
  if (ids.some((id) => !byId.has(id))) return null;
  return [...new Set(ids as string[])].map((id) => byId.get(id)!);
}
