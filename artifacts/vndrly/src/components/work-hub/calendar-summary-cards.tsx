import { CalendarClock, CheckSquare2, ChevronRight, MessageSquare, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import MiniCardDialogContent from "@/components/mini-card-dialog-content";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { WorkspacePanel } from "./workspace-panel";

type Row = Record<string, any>;
type Range = "next" | "week" | "month";

type SummaryItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  timestamp?: number;
};

type Summary = {
  key: string;
  title: string;
  value: string;
  detail: string;
  href: string;
  icon: typeof Users;
  items: SummaryItem[];
};

const when = (value: unknown) => value ? new Date(String(value)).toLocaleString() : "No date";
const timestamp = (value: unknown) => {
  const parsed = value ? new Date(String(value)).getTime() : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};
const taskUrgency = (item: Row) => item.urgent === true || ["urgent", "high"].includes(String(item.priority ?? "").toLowerCase());

export default function CalendarSummaryCards({ shifts = [], meetings = [], tasks = [], channels = [], scheduleUnavailable = false, channelsUnavailable = false }: { shifts?: Row[]; meetings?: Row[]; tasks?: Row[]; channels?: Row[]; scheduleUnavailable?: boolean; channelsUnavailable?: boolean }) {
  const { i18n } = useTranslation();
  const es = (i18n?.language ?? "en").startsWith("es");
  const [open, setOpen] = useState<Summary | null>(null);
  const [ranges, setRanges] = useState<Record<string, Range>>({});
  const now = Date.now();
  const upcomingShifts = shifts.filter((item) => new Date(item.startsAt).getTime() >= now).sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
  const upcomingMeetings = meetings.filter((item) => new Date(item.startsAt).getTime() >= now).sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
  const dueTasks = tasks
    .filter((item) => item.status !== "completed")
    .sort((a, b) => Number(taskUrgency(b)) - Number(taskUrgency(a)) || String(a.dueAt ?? a.startsAt).localeCompare(String(b.dueAt ?? b.startsAt)));
  const unreadChannels = channels.filter((item) => Number(item.unreadCount ?? 0) > 0);
  const summaries: Summary[] = [
    { key: "shift", title: "My next shift", value: upcomingShifts[0]?.title ?? "Nothing scheduled", detail: upcomingShifts[0]?.startsAt ? when(upcomingShifts[0].startsAt) : "No upcoming shifts", href: "/work-hub/calendar", icon: Users, items: upcomingShifts.map((item) => ({ id: String(item.id), title: item.title ?? "Scheduled shift", detail: `${when(item.startsAt)} – ${when(item.endsAt)}${item.siteName ? ` · ${item.siteName}` : ""}`, href: "/work-hub/calendar", timestamp: timestamp(item.startsAt) })) },
    { key: "meeting", title: "Next meeting", value: upcomingMeetings[0]?.title ?? "Nothing scheduled", detail: upcomingMeetings[0]?.startsAt ? when(upcomingMeetings[0].startsAt) : "No upcoming meetings", href: "/work-hub/meetings", icon: CalendarClock, items: upcomingMeetings.map((item) => ({ id: String(item.id), title: item.title ?? "Meeting", detail: `${when(item.startsAt)}${item.participantCount ? ` · ${item.participantCount} participants` : ""}`, href: `/work-hub/meetings?meeting=${item.id}`, timestamp: timestamp(item.startsAt) })) },
    { key: "task", title: "Tasks due soon", value: dueTasks[0]?.title ?? "No task due", detail: dueTasks[0]?.dueAt || dueTasks[0]?.startsAt ? when(dueTasks[0].dueAt ?? dueTasks[0].startsAt) : "No open tasks", href: "/work-hub/tasks", icon: CheckSquare2, items: dueTasks.map((item) => ({ id: String(item.id), title: `${taskUrgency(item) ? "Urgent · " : ""}${item.title ?? "Task"}`, detail: `${when(item.dueAt ?? item.startsAt)} · ${String(item.status ?? "open").replaceAll("_", " ")}`, href: `/work-hub/tasks?task=${item.id}`, timestamp: timestamp(item.dueAt ?? item.startsAt) })) },
    { key: "messages", title: "Unread conversations", value: String(unreadChannels.reduce((sum, item) => sum + Number(item.unreadCount ?? 0), 0)), detail: "Company and group chats", href: "/work-hub/chat", icon: MessageSquare, items: unreadChannels.map((item) => ({ id: String(item.id), title: item.name ?? item.channelName ?? "Conversation", detail: `${Number(item.unreadCount)} unread`, href: `/work-hub/chat?channel=${item.id}`, timestamp: timestamp(item.lastMessageAt ?? item.updatedAt) })) },
  ];

  const range = open ? (ranges[open.key] ?? "next") : "next";
  const cutoff = range === "week" ? now + 7 * 86_400_000 : range === "month" ? now + 30 * 86_400_000 : Number.POSITIVE_INFINITY;
  const visibleItems = (open?.items ?? [])
    .filter((item) => range === "next" || item.timestamp == null || item.timestamp <= cutoff)
    .slice(0, 10);

  const settings = open ? (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-semibold">Show</span>
      <div className="flex items-center gap-1" role="group" aria-label={`${open.title} range`}>
        {(["next", "week", "month"] as Range[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setRanges((current) => ({ ...current, [open.key]: option }))}
            aria-pressed={range === option}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
              range === option
                ? "border-white/60 bg-[color:var(--brand-primary)] text-white"
                : "border-white/30 bg-white text-gray-900",
            )}
          >
            {option === "next" ? "Next 10" : option === "week" ? "This week" : "This month"}
          </button>
        ))}
      </div>
    </div>
  ) : null;

  return <>
    <WorkspacePanel title={es ? "De un vistazo" : "At a glance"} subtitle={es ? "Turnos, reuniones, tareas y conversaciones" : "Shifts, meetings, tasks, and conversations"} icon={CalendarClock}>
      {summaries.map((summary) => {
        const unavailable = summary.key === "messages" ? channelsUnavailable : scheduleUnavailable;
        return <button key={summary.key} type="button" className="hub-home-row" onClick={() => setOpen(summary)} aria-label={`Open ${summary.title}`} aria-haspopup="dialog">
          <summary.icon aria-hidden="true" className="hub-row-icon" />
          <span className="hub-row-label">{summary.title}{!unavailable && <small className="mt-1 block text-xs font-normal text-[#b3b3b3]">{summary.detail}</small>}</span>
          <span className="hub-row-value">{unavailable ? "Unavailable" : summary.value}</span>
          <ChevronRight aria-hidden="true" className="hub-chevron" />
        </button>;
      })}
    </WorkspacePanel>
    <Dialog open={Boolean(open)} onOpenChange={(isOpen) => { if (!isOpen) setOpen(null); }}>
      <MiniCardDialogContent
        icon={open?.icon ?? Users}
        label={open?.title ?? "Calendar details"}
        definition="Live records from your Work Hub access."
        iconColor="var(--brand-primary)"
        settings={settings}
        className="max-h-[86vh] sm:max-w-lg"
      >
        {(open?.key === "messages" ? channelsUnavailable : scheduleUnavailable) ? <p role="status" className="text-sm text-muted-foreground">This source could not load. Open the workspace to check current records.</p> : visibleItems.length ? <ul className="space-y-2">{visibleItems.map((item) => <li key={item.id} data-testid="calendar-summary-item"><a href={item.href} className="block rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-3"><span className="block font-semibold text-black">{item.title}</span><span className="text-sm text-muted-foreground">{item.detail}</span></a></li>)}</ul> : <p className="text-sm text-muted-foreground">No matching records right now.</p>}
        {open && <a href={open.href} className="text-sm font-semibold text-[var(--brand-primary)] underline">View all</a>}
      </MiniCardDialogContent>
    </Dialog>
  </>;
}
