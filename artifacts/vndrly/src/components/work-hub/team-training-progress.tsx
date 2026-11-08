import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Users } from "lucide-react";
import { workHubRequest, isWorkHubAdmin } from "@/lib/work-hub-client";
import TrainingMessageButton from "./training-message-button";
import { formatTrainingTitle } from "@/lib/training-title";
import { useRepository } from "./repository-client";

type Course = { id: string; title: string; assignedAt: string; complete: boolean };
type Person = { userId: number; name: string; courses: Course[]; percentLabel: string;
  status: { color: string; label: string; rank: number } };
export default function TeamTrainingProgress() {
  const repo = useRepository({ enabled: false });
  const query = useQuery({
    queryKey: ["training-progress", "team", repo.user?.userId, repo.user?.activeMembershipId, repo.owner?.type, repo.owner?.id],
    queryFn: () => workHubRequest<{ people: Person[]; percentLabel: string }>("/repository/team-progress"),
    enabled: !!repo.owner, staleTime: 15_000, refetchInterval: 30_000, retry: false,
  });
  const people = query.data?.people ?? [];
  return <details className="hub-training-certificate" aria-label="Team Training"
    data-progress-team-state={query.isError ? "error" : query.data && !query.isFetching ? "ready" : "loading"}
    data-progress-team-updated-at={query.dataUpdatedAt}>
    <summary className="hub-home-row hub-training-summary"><Users aria-hidden="true" className="hub-row-icon" /><span className="hub-row-label">Team Training</span><span className="hub-row-value">{query.data?.percentLabel ?? "…"}</span><ChevronRight aria-hidden="true" className="hub-chevron" /></summary>
    <div className="team-training-people">
      <p className="text-xs text-muted-foreground py-2">Unfinished assignments: green through 7 days · amber over 7–14 days · red over 14 days.</p>
      {query.isPending && <p role="status">Consulting your Advisor…</p>}
      {query.isError && <p role="alert">Team training is unavailable. Try again shortly.</p>}
      {people.map(person => {
        const status = person.status;
        return <details key={person.userId} className="hub-training-certificate">
          <summary className="hub-home-row hub-training-summary" title={status.label}>
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
            <span className="hub-row-label" style={{ color: status.color }}>{person.name}</span>
            {isWorkHubAdmin(repo.user) && person.userId !== repo.user?.userId && <TrainingMessageButton person={person} />}
            <span className="hub-row-value" style={{ color: status.color }}>{person.percentLabel}</span><ChevronRight aria-hidden="true" className="hub-chevron" />
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
