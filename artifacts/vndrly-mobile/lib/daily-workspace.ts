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
    myWorkCount:
      s.tasks && s.tickets
        ? tasks.length +
          s.tickets.filter(
            (row) =>
              !["approved", "funds_dispersed", "cancelled", "denied"].includes(
                row.status,
              ),
          ).length +
          (s.runs?.length ?? 0) +
          (s.shifts?.length ?? 0)
        : null,
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
  const results = await Promise.allSettled([
    fetcher<any>("/api/work-hub/home"),
    fetcher<any>("/api/notifications?limit=100"),
    fetcher<any>("/api/safety/events?limit=50"),
    fetcher<any>(
      `/api/work-hub/calendar?start=${now.toISOString()}&end=${end.toISOString()}`,
    ),
    context?.field
      ? fetcher<any>("/api/field/open-tickets")
      : Promise.resolve({ tickets: [] }),
    context?.fleet
      ? fetcher<any>("/api/fleet/overview")
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
