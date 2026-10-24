import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { normalizeUnifiedCalendar, type UnifiedCalendarSources } from "@/lib/unified-work-calendar";

async function read<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "include", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("Schedule source unavailable");
  return response.json();
}

/** Each source remains permission scoped; failure never becomes an empty schedule. */
export function useOperationalCalendar(start: string, end: string, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["operational-calendar", user?.userId, user?.activeMembershipId, user?.vendorId, start, end],
    enabled: !!user?.vendorId && enabled,
    queryFn: async () => {
      const { categories } = await read<{ categories: string[] }>("/api/company-operations");
      const jobs: [keyof UnifiedCalendarSources, Promise<unknown>][] = [];
      if (categories.includes("field")) jobs.push(["tickets", read(`/api/me/upcoming-schedule?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)]);
      if (categories.includes("fleet")) jobs.push(["fleet", (async () => {
        type Page = NonNullable<UnifiedCalendarSources["fleet"]> & { page?: { nextCursor?: string | null } };
        const first = await read<Page>("/api/fleet/overview");
        const runs = [...(first.runs ?? [])], seen = new Set<string>();
        let cursor = first.page?.nextCursor;
        while (cursor) {
          if (seen.has(cursor)) throw new Error("Schedule pagination did not advance");
          seen.add(cursor);
          const page = await read<Page>(`/api/fleet/overview?cursor=${encodeURIComponent(cursor)}`);
          runs.push(...(page.runs ?? [])); cursor = page.page?.nextCursor;
        }
        return { runs };
      })()]);
      const sources: UnifiedCalendarSources = {}, unavailable: string[] = [];
      const results = await Promise.allSettled(jobs.map(([, job]) => job));
      results.forEach((result, index) => {
        if (result.status === "fulfilled") (sources as Record<string, unknown>)[jobs[index][0]] = result.value;
        else unavailable.push(jobs[index][0]);
      });
      return { unavailable, items: normalizeUnifiedCalendar(sources).filter(item => Date.parse(item.startsAt) < Date.parse(end) && Date.parse(item.endsAt ?? item.startsAt) >= Date.parse(start)) };
    },
  });
}
