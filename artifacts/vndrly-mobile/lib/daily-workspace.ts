import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "./api";
import type { NotificationRow } from "./notifications-ui";
import { useUnifiedWorkCalendar } from "./use-unified-work-calendar";
export type DailyTask = {
  id: string;
  title: string;
  status: string;
  dueAt?: string | null;
};
export type DailySafety = {
  id: number;
  title: string;
  status: string;
  eventNumber?: string;
};
export type DailySources = {
  tasks: DailyTask[] | null;
  notices: NotificationRow[] | null;
  safety: DailySafety[] | null;
  calendar: any | null;
  tickets: any[] | null;
  runs?: any[] | null;
  shifts?: any[];
  notificationLimited: boolean;
  safetyLimited: boolean;
};
export function pendingSafety(rows: DailySafety[]) {
  return rows.filter(
    (row) => !["resolved", "closed", "cancelled", "draft"].includes(row.status),
  );
}
export function pendingTasks(rows: DailyTask[]) {
  return rows.filter(
    (row) => !["completed", "cancelled", "archived"].includes(row.status),
  );
}
const persistentTypes = new Set([
  "cert_expired",
  "cert_expiring",
  "safety_stop_work",
  "safety_event_hipo",
]);
export function attentionNotices(s: DailySources) {
  const subjects = new Set([
    ...(s.safety
      ? pendingSafety(s.safety).map((row) => "/safety/" + row.id)
      : []),
    ...(s.tasks
      ? pendingTasks(s.tasks).map((row) => "/work-hub/tasks/" + row.id)
      : []),
  ]);
  return (s.notices ?? []).filter(
    (n) =>
      n.type !== "safety_event_closed" &&
      (!n.isRead || persistentTypes.has(n.type)) &&
      !subjects.has(n.link ?? ""),
  );
}

export function myWorkItems(s: DailySources) {
  const items: { kind: "task" | "ticket" | "run" | "shift"; id: string; title: string; status: string; assignedAt: string | null }[] = [];
  for (const task of pendingTasks(s.tasks ?? [])) items.push({ kind: "task", id: task.id, title: task.title, status: task.status, assignedAt: (task as DailyTask & {createdAt?:string;assignedAt?:string}).assignedAt ?? (task as DailyTask & {createdAt?:string}).createdAt ?? null });
  for (const ticket of s.tickets ?? []) if (!["approved","funds_dispersed","cancelled","denied"].includes(ticket.status)) items.push({kind:"ticket",id:String(ticket.id),title:`Ticket #${ticket.id} · ${ticket.siteName ?? "Assigned site"}`,status:ticket.status,assignedAt:ticket.assignedAt ?? ticket.createdAt ?? null});
  for (const run of s.runs ?? []) if (!["draft","completed","cancelled"].includes(run.status)) {
    const latest = [...(run.events ?? [])].filter((event:any)=>["dispatch","reassign","dispatched","reassigned"].includes(event.type)).sort((a:any,b:any)=>Date.parse(b.recordedAt)-Date.parse(a.recordedAt))[0];
    items.push({kind:"run",id:run.id,title:run.title,status:run.status,assignedAt:latest?.recordedAt ?? run.assignedAt ?? null});
  }
  for (const row of s.shifts ?? []) if (!["cancelled","declined"].includes(row.assignment?.status) && !["cancelled","completed"].includes(row.shift?.milestoneStatus)) items.push({kind:"shift",id:row.shift.id,title:row.shift.title ?? "Assigned shift",status:row.assignment?.status ?? "assigned",assignedAt:row.assignment?.createdAt ?? null});
  const timestamp=(value:string|null)=>value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  return items.sort((a,b)=>timestamp(b.assignedAt)-timestamp(a.assignedAt)||`${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
}
export function dailySummary(s: DailySources) {
  const tasks = s.tasks ? pendingTasks(s.tasks) : [],
    safety = s.safety ? pendingSafety(s.safety) : [],
    notices = attentionNotices(s),
    calendar = s.calendar
      ? [...(s.calendar.shifts ?? []), ...(s.calendar.meetings ?? [])]
      : [];
  return {
    attentionCount:
      s.tasks && s.safety && s.notices
        ? tasks.length + safety.length + notices.length
        : null,
    safetyCount: s.safety ? safety.length : null,
    myWorkCount: s.tasks && s.tickets ? myWorkItems(s).length : null,
    calendarCount:
      s.calendar && s.tickets
        ? calendar.length +
          s.tickets.filter((row) => row.scheduledStartAt).length
        : null,
    topAttentionLabel: safety[0]?.title ?? tasks[0]?.title ?? notices[0]?.title,
    nextCalendarLabel: undefined as string | undefined,
  };
}
export async function loadDailySources(
  fetcher: typeof apiFetch = apiFetch,
  context?: {
    field: boolean;
    fleet: boolean;
    userId: number;
    vendorId?: number | null;
    partnerId?: number | null;
  },
): Promise<DailySources> {
  const now = new Date(),
    end = new Date(now);
  end.setDate(end.getDate() + 90);
  const fleetRuns = async () => {
    const first = await fetcher<any>("/api/fleet/overview"); const runs = [...(first.runs ?? [])]; const seen = new Set<string>(); let cursor = first.page?.nextCursor;
    while (cursor) { if (seen.has(cursor)) throw Error("Fleet pagination did not advance"); seen.add(cursor); const next=await fetcher<any>(`/api/fleet/overview?cursor=${encodeURIComponent(cursor)}`); runs.push(...(next.runs??[])); cursor=next.page?.nextCursor; }
    return {runs};
  };
  const results = await Promise.allSettled([
    fetcher<any>("/api/work-hub/home?workOrder=assigned"),
    fetcher<any>("/api/notifications?limit=100"),
    fetcher<any>("/api/safety/events?limit=50"),
    fetcher<any>(
      `/api/work-hub/calendar?start=${now.toISOString()}&end=${end.toISOString()}`,
    ),
    context?.field
      ? fetcher<any>("/api/field/open-tickets?assignedToMe=1")
      : Promise.resolve({ tickets: [] }),
    context?.fleet
      ? fleetRuns()
      : Promise.resolve({ runs: [] }),
  ]);
  const value = (i: number) =>
      results[i].status === "fulfilled"
        ? (results[i] as PromiseFulfilledResult<any>).value
        : null,
    n = value(1),
    s = value(2);
  return {
    tasks: value(0)?.tasks ?? null,
    notices: n ? (Array.isArray(n) ? n : n.items) : null,
    safety: s?.data ?? null,
    calendar: value(3),
    tickets: value(4)
      ? Array.isArray(value(4))
        ? value(4)
        : (value(4).tickets ?? [])
      : null,
    runs: value(5)
      ? (value(5).runs ?? []).filter(
          (run:any) =>
            run.driverUserId === context?.userId &&
            !["completed", "cancelled"].includes(run.status),
        )
      : null,
    shifts: (value(0)?.shifts ?? []).filter(
      (row:any) =>
        row.shift?.ownerOrgId === (context?.vendorId ?? context?.partnerId) &&
        row.shift?.ownerOrgType === (context?.vendorId ? "vendor" : "partner"),
    ),
    notificationLimited:
      !!n && (Array.isArray(n) ? n.length === 100 : !!n.nextCursor),
    safetyLimited: !!s?.data && s.data.length === 50,
  };
}
export function useDailySummary() {
  const { user, activeMembershipId } = useAuth();
  const calendar = useUnifiedWorkCalendar(),
    q = useQuery({
      queryKey: [
        "daily-workspace",
        user?.id,
        activeMembershipId,
        user?.vendorId,
        user?.partnerId,
        calendar.data?.categories.join(","),
      ],
      queryFn: () =>
        loadDailySources(apiFetch, {
          field: calendar.data?.categories.includes("field") ?? false,
          fleet: calendar.data?.categories.includes("fleet") ?? false,
          userId: user!.id,
          vendorId: user?.vendorId,
          partnerId: user?.partnerId,
        }),
      enabled: !!user,
      refetchInterval: 30000,
    });
  const data = q.data ? dailySummary(q.data) : undefined;
  if (data)
    data.calendarCount =
      calendar.data && !calendar.data.unavailable.length
        ? calendar.data.items.filter(
            (item) =>
              !["cancelled", "completed", "declined"].includes(
                item.status ?? "",
              ) && Date.parse(item.endsAt ?? item.startsAt) >= Date.now(),
          ).length
        : null;
  return {
    ...q,
    data,
    sources: q.data,
    isError:
      q.isError ||
      calendar.isError ||
      (!!q.data &&
        [
          q.data.tasks,
          q.data.notices,
          q.data.safety,
          q.data.tickets,
          q.data.runs,
        ].some((value) => value === null)),
  };
}
