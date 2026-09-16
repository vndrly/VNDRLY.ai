import { CalendarClock, CheckSquare2, MessageSquare, Users } from "lucide-react";
import { useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Row = Record<string, any>;

type Summary = {
  key: string;
  title: string;
  value: string;
  detail: string;
  href: string;
  icon: typeof Users;
  items: Array<{ id: string; title: string; detail: string; href: string }>;
};

const when = (value: unknown) => value ? new Date(String(value)).toLocaleString() : "No date";

export default function CalendarSummaryCards({ shifts = [], meetings = [], tasks = [], channels = [] }: { shifts?: Row[]; meetings?: Row[]; tasks?: Row[]; channels?: Row[] }) {
  const [open, setOpen] = useState<Summary | null>(null);
  const now = Date.now();
  const upcomingShifts = shifts.filter((item) => new Date(item.startsAt).getTime() >= now).sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
  const upcomingMeetings = meetings.filter((item) => new Date(item.startsAt).getTime() >= now).sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
  const dueTasks = tasks.filter((item) => item.status !== "completed").sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
  const unreadChannels = channels.filter((item) => Number(item.unreadCount ?? 0) > 0);
  const summaries: Summary[] = [
    { key: "shift", title: "My next shift", value: upcomingShifts[0]?.title ?? "Nothing scheduled", detail: upcomingShifts[0]?.startsAt ? when(upcomingShifts[0].startsAt) : "No upcoming shifts", href: "/work-hub/calendar", icon: Users, items: upcomingShifts.map((item) => ({ id: String(item.id), title: item.title ?? "Scheduled shift", detail: `${when(item.startsAt)} – ${when(item.endsAt)}${item.siteName ? ` · ${item.siteName}` : ""}`, href: "/work-hub/calendar" })) },
    { key: "meeting", title: "Next meeting", value: upcomingMeetings[0]?.title ?? "Nothing scheduled", detail: upcomingMeetings[0]?.startsAt ? when(upcomingMeetings[0].startsAt) : "No upcoming meetings", href: "/work-hub/meetings", icon: CalendarClock, items: upcomingMeetings.map((item) => ({ id: String(item.id), title: item.title ?? "Meeting", detail: `${when(item.startsAt)}${item.participantCount ? ` · ${item.participantCount} participants` : ""}`, href: `/work-hub/meetings?meeting=${item.id}` })) },
    { key: "task", title: "Tasks due soon", value: dueTasks[0]?.title ?? "No task due", detail: dueTasks[0]?.startsAt ? when(dueTasks[0].startsAt) : "No open tasks", href: "/work-hub/tasks", icon: CheckSquare2, items: dueTasks.map((item) => ({ id: String(item.id), title: item.title ?? "Task", detail: `${when(item.startsAt)} · ${String(item.status ?? "open").replaceAll("_", " ")}`, href: `/work-hub/tasks?task=${item.id}` })) },
    { key: "messages", title: "Unread conversations", value: String(unreadChannels.reduce((sum, item) => sum + Number(item.unreadCount ?? 0), 0)), detail: "Channels and direct chats", href: "/work-hub/channels", icon: MessageSquare, items: unreadChannels.map((item) => ({ id: String(item.id), title: item.name ?? item.channelName ?? "Conversation", detail: `${Number(item.unreadCount)} unread`, href: `/work-hub/channels?channel=${item.id}` })) },
  ];

  return <>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {summaries.map((summary) => <Card key={summary.key} className="border-2 border-[color:var(--brand-primary)] bg-white">
        <button type="button" className="w-full text-left" onClick={() => setOpen(summary)} aria-label={`Open ${summary.title}`}>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2"><summary.icon className="h-5 w-5 text-[var(--brand-primary)]" /><p className="text-xs font-semibold uppercase text-muted-foreground">{summary.title}</p></div>
            <p className="mt-2 font-semibold text-black">{summary.value}</p><p className="text-xs text-muted-foreground">{summary.detail}</p>
          </CardContent>
        </button>
      </Card>)}
    </div>
    <Dialog open={Boolean(open)} onOpenChange={(isOpen) => { if (!isOpen) setOpen(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{open?.title}</DialogTitle><DialogDescription>Live records from your Work Hub access.</DialogDescription></DialogHeader>
        {open?.items.length ? <ul className="max-h-[50vh] space-y-2 overflow-y-auto">{open.items.map((item) => <li key={item.id}><a href={item.href} className="block rounded-lg border border-border bg-white p-3 hover:border-[var(--brand-primary)]"><span className="block font-semibold text-black">{item.title}</span><span className="text-sm text-muted-foreground">{item.detail}</span></a></li>)}</ul> : <p className="text-sm text-muted-foreground">No matching records right now.</p>}
        {open && <a href={open.href} className="text-sm font-semibold text-[var(--brand-primary)] underline">View all</a>}
      </DialogContent>
    </Dialog>
  </>;
}
