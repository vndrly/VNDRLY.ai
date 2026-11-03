import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Users } from "lucide-react";
import { workHubRequest, isWorkHubAdmin } from "@/lib/work-hub-client";
import TrainingMessageButton from "./training-message-button";
import { formatTrainingTitle } from "@/lib/training-title";
import { useRepository } from "./repository-client";

type Course = { id: string; title: string; assignedAt: string; complete: boolean };
type Person = { userId: number; name: string; courses: Course[] };
export function personTrainingStatus(courses: Course[], now = Date.now()) {
  if (!courses.length) return { color: "#9ca3af", label: "No assigned training", rank: 3 };
  const pending = courses.filter(course => !course.complete);
  if (!pending.length) return { color: "#22c55e", label: "Completed", rank: 2 };
  const days = (now - Math.min(...pending.map(course => Date.parse(course.assignedAt)))) / 86_400_000;
  return days > 14 ? { color: "#f87171", label: "Falling behind · over 14 days", rank: 0 }
    : days > 7 ? { color: "#f59e0b", label: "Needs attention · over 7 days", rank: 1 }
    : { color: "#22c55e", label: "On track · 7 days or less", rank: 2 };
}
function percent(courses: Course[]) {
  return courses.length ? `${Math.round(courses.filter(course => course.complete).length / courses.length * 100)}%` : "—";
}
export default function TeamTrainingProgress() {
  const repo = useRepository({ enabled: false });
  const query = useQuery({
    queryKey: ["training-progress", "team", repo.user?.userId, repo.user?.activeMembershipId, repo.owner?.type, repo.owner?.id],
    queryFn: () => workHubRequest<{ people: Person[] }>("/repository/team-progress"),
    enabled: !!repo.owner, staleTime: 15_000, refetchInterval: 30_000, retry: false,
  });
  // Read dataUpdatedAt so age colors are recalculated even if the snapshot is unchanged.
  const now = Math.max(Date.now(), query.dataUpdatedAt ?? 0);
  const people = [...(query.data?.people ?? [])].sort((a, b) => personTrainingStatus(a.courses, now).rank - personTrainingStatus(b.courses, now).rank || a.name.localeCompare(b.name));
  const courses = people.flatMap(person => person.courses);
  return <details className="hub-training-certificate" aria-label="Team Training">
    <summary className="hub-home-row hub-training-summary"><Users aria-hidden="true" className="hub-row-icon" /><span className="hub-row-label">Team Training</span><span className="hub-row-value">{query.data ? percent(courses) : "…"}</span><ChevronRight aria-hidden="true" className="hub-chevron" /></summary>
    <div className="team-training-people">
      <p className="text-xs text-muted-foreground py-2">Unfinished assignments: green through 7 days · amber over 7–14 days · red over 14 days.</p>
      {query.isPending && <p role="status">Loading team training…</p>}
      {query.isError && <p role="alert">Team training is unavailable. Try again shortly.</p>}
      {people.map(person => {
        const status = personTrainingStatus(person.courses, now);
        return <details key={person.userId} className="hub-training-certificate">
          <summary className="hub-home-row hub-training-summary" title={status.label}>
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
            <span className="hub-row-label" style={{ color: status.color }}>{person.name}</span>
            {isWorkHubAdmin(repo.user) && person.userId !== repo.user?.userId && <TrainingMessageButton person={person} />}
            <span className="hub-row-value" style={{ color: status.color }}>{percent(person.courses)}</span><ChevronRight aria-hidden="true" className="hub-chevron" />
          </summary>
          <p style={{ color: status.color }} className="text-xs py-2">{status.label}</p>
          <ul className="text-sm space-y-2 pb-3" aria-label={`${person.name} courses`}>
            {person.courses.map(course => <li key={course.id} className="flex justify-between gap-3"><span>{formatTrainingTitle(course.title)}</span><span className="shrink-0 text-xs">{course.complete ? "Completed" : `Assigned ${new Date(course.assignedAt).toLocaleDateString()}`}</span></li>)}
          </ul>
        </details>;
      })}
      {query.data && !people.length && <p>No current company members.</p>}
    </div>
  </details>;
}
