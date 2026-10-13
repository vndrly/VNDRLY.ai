import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { WORK_HUB_SUBCARD_CLASS } from "./chrome";

type SafetyEvent = { id: number; title: string; status: string };
type WorkItem = { id: string; title: string; href: string; status: string };
async function read(path: string) {
  const response = await fetch(path, { credentials: "include", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("Daily source unavailable");
  return response.json();
}
export function DailyWorkspace() {
  const { user } = useAuth();
  const work = useQuery({
    queryKey: ["daily-my-work", user?.userId, user?.activeMembershipId], enabled: !!user, refetchInterval: 30000,
    queryFn: async () => {
      const categories = user?.vendorId ? (await read("/api/company-operations")).categories as string[] : [];
      const jobs: [string, Promise<any>][] = [["tasks", read("/api/work-hub/home")]];
      if (categories.includes("field")) jobs.push(["tickets", read("/api/field/open-tickets")]);
      if (categories.includes("fleet")) jobs.push(["runs", (async () => {
        const page = await read("/api/fleet/overview"), runs = [...(page.runs ?? [])], seen = new Set<string>();
        let cursor = page.page?.nextCursor;
        while (cursor) { if (seen.has(cursor)) throw new Error("Daily pagination did not advance"); seen.add(cursor); const next = await read(`/api/fleet/overview?cursor=${encodeURIComponent(cursor)}`); runs.push(...(next.runs ?? [])); cursor = next.page?.nextCursor; }
        return { runs };
      })()]);
      const results = await Promise.allSettled(jobs.map(([, job]) => job));
      const items: WorkItem[] = [], unavailable: string[] = [];
      results.forEach((result, index) => {
        const kind = jobs[index][0];
        if (result.status === "rejected") { unavailable.push(kind); return; }
        const value = result.value;
        if (kind === "tasks") items.push(...(value.tasks ?? []).filter((row: any) => !["completed", "cancelled", "archived"].includes(row.status)).map((row: any) => ({ id: `task:${row.id}`, title: row.title, status: row.status, href: `/work-hub/tasks?task=${encodeURIComponent(row.id)}` })));
        if (kind === "tickets") items.push(...(Array.isArray(value) ? value : value.tickets ?? []).filter((row: any) => !["approved", "funds_dispersed", "cancelled", "denied"].includes(row.status)).map((row: any) => ({ id: `ticket:${row.id}`, title: row.ticketNumber ?? `Ticket #${row.id}`, status: row.status, href: `/tickets/${row.id}` })));
        if (kind === "runs") items.push(...(value.runs ?? []).filter((row: any) => row.driverUserId === user?.userId && !["completed", "cancelled"].includes(row.status)).map((row: any) => ({ id: `run:${row.id}`, title: row.title, status: row.status, href: `/fleet/runs/${encodeURIComponent(row.id)}` })));
      });
      return { items, unavailable };
    },
  });
  const safety = useQuery({
    queryKey: ["daily-safety", user?.userId, user?.activeMembershipId],
    enabled: !!user,
    refetchInterval: 30000,
    queryFn: async () => {
      const response = await fetch("/api/safety/events?limit=50", { credentials: "include", signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error("Safety events unavailable");
      return response.json() as Promise<{ data: SafetyEvent[] }>;
    },
  });
  const pending = safety.data?.data.filter(row => !["resolved", "closed", "cancelled", "draft"].includes(row.status)) ?? [];
  return <section aria-label="Daily workspace" className="mb-5 space-y-3">
    <div className="grid gap-3 sm:grid-cols-4">
      {[ ["Calendar", "/work-hub/calendar"], ["My Work", "#daily-my-work"], ["Needs Attention", "/notifications"], ["Safety", "/safety"] ].map(([label, href]) => <a key={label} href={href} className={`${WORK_HUB_SUBCARD_CLASS} p-4 font-semibold`}>{label}</a>)}
    </div>
    <a className="underline" href="/work-hub/native-work">Shift and On Call</a>
    <div id="daily-my-work" className={`${WORK_HUB_SUBCARD_CLASS} p-4`}>
      <h2 className="font-semibold">My Work</h2>
      {work.isPending ? <p role="status">Loading your work…</p> : work.isError ? <p role="status">My Work unavailable; refresh before relying on this list.</p> : <>
        {!!work.data?.unavailable.length && <p role="status">Some work sources are unavailable. Displayed work is partial.</p>}
        <ul>{work.data?.items.map(item => <li key={item.id}><a className="underline" href={item.href}>{item.title}</a> · {item.status.replaceAll("_", " ")}</li>)}</ul>
        {!work.data?.items.length && !work.data?.unavailable.length && <p>No active work in returned records.</p>}
      </>}
    </div>
    <div className={`${WORK_HUB_SUBCARD_CLASS} p-4`}>
      <h2 className="font-semibold">Safety needs attention</h2>
      {safety.isPending ? <p role="status">Loading safety events…</p> : safety.isError ? <p role="status">Safety events unavailable; coverage is partial.</p> : <>
        {pending.length ? <ul>{pending.map(row => <li key={row.id}><a className="underline" href={`/safety/${row.id}`}>{row.title}</a> · {row.status.replaceAll("_", " ")}</li>)}</ul> : <p>No active safety events in returned records.</p>}
        {safety.data?.data.length === 50 && <p className="text-xs">Showing the first 50 safety events. Open Safety for the complete list.</p>}
      </>}
    </div>
  </section>;
}
