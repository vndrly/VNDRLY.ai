import { BellRing } from "lucide-react";

import { WORK_HUB_SUBCARD_CLASS } from "./chrome";

type Row = Record<string, any>;

export function ActivityDashboard({ home, onAcknowledge, acknowledging = false }: { home?: Row; onAcknowledge?: (id: string) => void; acknowledging?: boolean }) {
  const now = Date.now();
  const tasks: Row[] = home?.tasks ?? [];
  const announcements: Row[] = home?.announcements ?? [];
  const urgent = announcements.filter(({ announcement }: Row) => announcement.urgency === "urgent");
  const important = announcements.filter(({ announcement, recipient }: Row) => announcement.urgency !== "urgent" && announcement.acknowledgementRequired && !recipient.acknowledgedAt);
  const overdueTasks = tasks.filter((task) => task.status !== "completed" && task.dueAt && new Date(task.dueAt).getTime() < now);
  const dueSoonTasks = tasks.filter((task) => task.status !== "completed" && task.dueAt && new Date(task.dueAt).getTime() >= now && new Date(task.dueAt).getTime() <= now + 7 * 86_400_000);
  const priorityItems: Array<{ id: string; rank: number; label: string; detail: string; href: string; kind: string; acknowledgeId?: string; acknowledged?: boolean }> = [
    ...urgent.map(({ announcement, recipient }: Row) => ({ id: `urgent-${announcement.id}`, rank: 0, label: announcement.title, detail: announcement.body, href: announcement.deepLink ?? "/work-hub/activity", kind: "Urgent", acknowledgeId: announcement.acknowledgementRequired && !recipient.acknowledgedAt ? announcement.id : undefined, acknowledged: Boolean(recipient.acknowledgedAt) })),
    ...overdueTasks.map((task) => ({ id: `overdue-${task.id}`, rank: 1, label: task.title, detail: `Due ${new Date(task.dueAt).toLocaleString()}`, href: `/work-hub/tasks?task=${task.id}`, kind: "Overdue task" })),
    ...important.map(({ announcement }: Row) => ({ id: `important-${announcement.id}`, rank: 2, label: announcement.title, detail: announcement.body, href: announcement.deepLink ?? "/work-hub/activity", kind: "Acknowledgement needed", acknowledgeId: announcement.id })),
    ...dueSoonTasks.map((task) => ({ id: `due-${task.id}`, rank: 3, label: task.title, detail: `Due ${new Date(task.dueAt).toLocaleString()}`, href: `/work-hub/tasks?task=${task.id}`, kind: "Due soon" })),
  ].sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label)).slice(0, 5);

  return <>
    <section aria-label="Top five priorities" className={`${WORK_HUB_SUBCARD_CLASS} mb-5 p-4`}>
      <div className="flex items-center gap-2"><BellRing className="h-5 w-5 text-[var(--brand-primary)]" /><h2 className="text-lg font-semibold text-black">Top five priorities</h2></div>
      {priorityItems.length ? <ol className="mt-3 grid gap-2">{priorityItems.map((item, index) => <li key={item.id} className="flex items-start gap-3 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-primary)] text-xs font-bold text-white">{index + 1}</span><a href={item.href} className="min-w-0 flex-1"><span className="block text-xs font-semibold uppercase text-muted-foreground">{item.kind}</span><span className="block font-semibold text-black">{item.label}</span><span className="line-clamp-2 text-sm text-muted-foreground">{item.detail}</span></a>{item.acknowledged ? <span className="text-xs font-semibold text-muted-foreground">Acknowledged</span> : item.acknowledgeId && onAcknowledge ? <button type="button" className="rounded-full border-2 border-[var(--brand-primary)] bg-white px-3 py-1 text-xs font-semibold" disabled={acknowledging} onClick={() => onAcknowledge(item.acknowledgeId!)}>Acknowledge</button> : null}</li>)}</ol> : <p className="mt-3 text-sm text-muted-foreground">{home ? "Nothing urgent needs your attention right now." : "Priorities unavailable; open Tasks & Forms to check current work."}</p>}
    </section>
  </>;
}
