import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { CalendarDays, CheckSquare2, FileText, Link2, MessageSquare, Search, Video } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const MODULES = {
  channels: { title: "Channels", description: "Conversations tied to the organizations, sites, tickets, and teams you already work with.", icon: MessageSquare },
  calendar: { title: "Calendar", description: "A shared operational view of shifts, tasks, meetings, and connected calendar events.", icon: CalendarDays },
  files: { title: "Files & Notes", description: "Durable context, versioned notes, and finalized files governed by the same access boundary.", icon: FileText },
  tasks: { title: "Tasks & Forms", description: "Assignments, checklists, forms, acknowledgements, announcements, and approvals.", icon: CheckSquare2 },
  meetings: { title: "Meetings", description: "Scheduled conversations with attendance, chat, and consent-aware recording controls.", icon: Video },
  search: { title: "Search", description: "Find the Work Hub records you are authorized to see without crossing tenant boundaries.", icon: Search },
  settings: { title: "Settings & Connections", description: "Manage notification preferences and optional Microsoft 365 connections.", icon: Link2 },
} as const;

async function getHome() {
  const response = await fetch("/api/work-hub/home", { credentials: "include" });
  if (!response.ok) throw new Error(response.status === 404 ? "Work Hub is not enabled for this organization yet." : "Work Hub could not be loaded.");
  return response.json();
}

export default function WorkHubPage() {
  const [location] = useLocation();
  const segment = location.split("/")[2] as keyof typeof MODULES | undefined;
  const selected = segment ? MODULES[segment] : undefined;
  const home = useQuery({ queryKey: ["work-hub", "home"], queryFn: getHome, enabled: !selected, retry: false });
  if (selected) {
    const Icon = selected.icon;
    return <section className="mx-auto max-w-6xl p-4 md:p-8" data-testid={`work-hub-${segment}`}><div className="mb-6 flex items-center gap-3"><Icon className="h-7 w-7 text-[var(--brand-primary)]"/><div><p className="text-xs font-semibold uppercase tracking-[.2em] text-muted-foreground">Work Hub</p><h1 className="text-3xl font-bold">{selected.title}</h1></div></div><Card><CardHeader><CardTitle>{selected.title}</CardTitle></CardHeader><CardContent><p className="text-muted-foreground">{selected.description}</p>{segment === "settings" && <p className="mt-4 rounded-lg border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">Microsoft 365 connection is optional and remains safely unavailable until provider credentials are configured.</p>}</CardContent></Card></section>;
  }
  return <section className="mx-auto max-w-6xl p-4 md:p-8" data-testid="work-hub-home"><p className="text-xs font-semibold uppercase tracking-[.2em] text-muted-foreground">Work Hub</p><h1 className="mt-1 text-3xl font-bold">One place for the work around the work.</h1><p className="mt-2 max-w-2xl text-muted-foreground">Coordinate conversations, schedules, tasks, files, forms, and meetings inside your existing VNDRLY context.</p>{home.isError && <div role="status" className="mt-6 rounded-lg border border-amber-400/50 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">{(home.error as Error).message}</div>}<div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Object.entries(MODULES).map(([key, item]) => { const Icon = item.icon; return <a key={key} href={`/work-hub/${key}`} className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"><Card className="h-full transition-transform hover:-translate-y-0.5"><CardHeader><Icon className="h-5 w-5 text-[var(--brand-primary)]"/><CardTitle className="text-lg">{item.title}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{item.description}</CardContent></Card></a>;})}</div></section>;
}
