import type { ScheduleShift } from "./shift-assignment-model";
export const coverageCategories = [
  "Urgent gaps",
  "New / Unassigned Recurring Shifts",
  "Needs temporary coverage",
  "Shift requested off",
  "Awaiting acknowledgment",
] as const;
export type CoverageCategory = (typeof coverageCategories)[number];
export type CoverageGap = {
  id: string;
  category: CoverageCategory;
  siteId: number;
  siteName: string;
  shift: ScheduleShift | null;
  title: string;
  detail: string;
  originalUserId?: number;
  requestId?: string;
  requestStatus?: "pending"|"approved";
  awaitingAcknowledgment?: {notificationId:number;name:string};
  required: number;
};
export type CoverageFacts = {
  awaitingAcknowledgment?: {notificationId:number;shiftId:string;userId:number;name:string}[];
  unavailable: { userId: number; startsAt: string; endsAt: string }[];
  workers: { userId: number; state: "active" | "hold" | "inactive" }[];
  requests: { id: string; shiftId: string; userId: number;status?:"pending"|"approved" }[];
  urgentShiftIds: string[];
  incidents?: {shiftId:string; userId?:number; reason:"No-show"|"Abandoned shift"}[];
  readOnly: boolean;
};
export function classifyCoverage(
  siteId: number,
  siteName: string,
  shifts: ScheduleShift[],
  facts: CoverageFacts,
  now = Date.now(),
): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (const shift of shifts) {
    if (Date.parse(shift.endsAt) <= now) continue;
    const firstGap = gaps.length;
    const base = { siteId, siteName, shift, title: shift.pattern, required: 1 };
    const requests = facts.requests.filter(
      (r) => r.shiftId === shift.id && shift.assignees.includes(r.userId),
    );
    const unavailable = shift.assignees.filter(
      (id) =>
        facts.workers.some((w) => w.userId === id && w.state !== "active") ||
        facts.unavailable.some(
          (w) =>
            w.userId === id &&
            w.startsAt < shift.endsAt &&
            w.endsAt > shift.startsAt,
        ),
    );
    const affected = new Set<number>();
    for(const r of requests){
      affected.add(r.userId);
      gaps.push({...base,id:`request:${r.id}`,category:'Shift requested off',originalUserId:r.userId,requestId:r.id,requestStatus:r.status??'pending',
        detail:r.status==='approved'?'Shift off approved — needs replacement':'Shift off requested — awaiting approval'});
    }
    for (const pending of facts.awaitingAcknowledgment ?? []) {
      if(pending.shiftId !== shift.id || !shift.assignees.includes(pending.userId)||affected.has(pending.userId)) continue;
      affected.add(pending.userId);
      gaps.push({...base,id:`ack:${pending.notificationId}`,category:"Awaiting acknowledgment",
        originalUserId:pending.userId,awaitingAcknowledgment:pending,
        detail:`Awaiting acknowledgment · ${pending.name}`});
    }
    for (const userId of unavailable) {
      if(affected.has(userId)) continue;
      affected.add(userId);
      const inactive = facts.workers.some(
        (w) => w.userId === userId && w.state === "inactive",
      );
      gaps.push({
        ...base,
        id: `worker:${shift.id}:${userId}`,
        category: inactive ? "New / Unassigned Recurring Shifts" : "Needs temporary coverage",
        originalUserId: userId,
        requestId: requests.find((r) => r.userId === userId)?.id,
        detail: inactive
          ? "Needs gatekeeper — previous gatekeeper is no longer active."
          : "Assigned worker is on hold or has recorded unavailability.",
      });
    }
    const needed = Math.max(0, shift.required - shift.assignees.length);
    if (needed)
      gaps.push({
        ...base,
        id: `vacancy:${shift.id}`,
        category: "New / Unassigned Recurring Shifts",
        required: needed,
        detail: `Needs gatekeeper — ${needed} unassigned position(s).`,
      });
    const incidents = (facts.incidents ?? []).filter(i => i.shiftId === shift.id);
    const soon = Date.parse(shift.startsAt) <= now + 24 * 60 * 60 * 1000;
    const shiftGaps = gaps.slice(firstGap);
    for (const gap of shiftGaps) {
      const incident = incidents.find(i => i.userId === undefined || i.userId === gap.originalUserId);
      const uncovered = gap.category !== "Awaiting acknowledgment" && gap.requestStatus !== "pending";
      if (uncovered && (soon || incident)) gaps.push({...gap, id:`urgent:${gap.id}`, category:"Urgent gaps",
        detail: incident ? `${incident.reason} — needs coverage.` : gap.detail});
    }
    for (const incident of incidents) {
      const users = incident.userId === undefined ? shift.assignees : shift.assignees.filter(id => id === incident.userId);
      for (const userId of users) {
        if (gaps.slice(firstGap).some(g => g.category === "Urgent gaps" && g.originalUserId === userId)) continue;
        const existing = shiftGaps.find(g => g.originalUserId === userId);
        gaps.push({...base, ...existing, id:`urgent:incident:${shift.id}:${userId}`, category:"Urgent gaps",
          originalUserId:userId, detail:`${incident.reason} — needs coverage.`});
      }
    }
  }
  return gaps;
}
