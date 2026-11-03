import { useQuery } from "@tanstack/react-query";
import { workHubRequest } from "@/lib/work-hub-client";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import { GraduationCap, Layers, CheckCircle, Plus, ChevronRight } from "lucide-react";
import { useRepository, type RepositoryData } from "./repository-client";
import {
  RepositoryAudience,
  emptyAudience,
  type Audience,
} from "./repository-audience";
import OptionSwitch from "./library/option-switch";
import "./repository-theme.css";
import { formatTrainingTitle } from "@/lib/training-title";
import TeamTrainingProgress from "./team-training-progress";
import { trainingProgressOptions } from "@/lib/training-progress-query";
import { trainingProgressExperimentsEnabled } from "@/lib/training-progress-experiment";
export { formatTrainingTitle as certificateDisplayTitle } from "@/lib/training-title";
function completionPercent(items: RepositoryData["certifications"]) {
  const total = items.reduce((sum, item) => sum + Math.max(item.steps.length, 1), 0);
  const completed = items.reduce((sum, item) => sum + (item.steps.length ? item.steps.filter((step) => step.complete).length : Number(item.complete)), 0);
  return total ? Math.round(completed / total * 100) : 0;
}
function useTrainingProgress() {
  const repo = useRepository({ enabled: false });
  const progress = useQuery(trainingProgressOptions(repo.user, repo.owner));
  return { repo, progress };
}
export function TrainingCompletionTotal() {
  const { progress, repo } = useTrainingProgress();
  const safety = useQuery({
    queryKey: ["training-progress", "safety-summary", repo.user?.userId, repo.user?.activeMembershipId, repo.owner?.type, repo.owner?.id],
    queryFn: () => workHubRequest<{ score: number; maximum: number; bonus: number; incomplete: boolean }>("/repository/safety-summary"),
    enabled: !!repo.owner, staleTime: 15_000, refetchInterval: 30_000, retry: false,
  });
  if (!progress.data) return trainingProgressExperimentsEnabled ? <span hidden data-progress-overall-state={progress.isError || safety.isError ? "error" : "loading"} /> : null;
  const steps = new Map<string, boolean>();
  for (const course of progress.data.certifications) {
    for (const step of course.steps) {
      const key = `${course.userId}:${step.type}:${step.id}`;
      steps.set(key, step.complete && (steps.get(key) ?? true));
    }
  }
  const percent = steps.size ? Math.round([...steps.values()].filter(Boolean).length / steps.size * 100) : 0;
  return <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm font-semibold"
    data-progress-overall-state={progress.isError || safety.isError ? "error" : safety.data && !progress.isFetching && !safety.isFetching ? "ready" : "loading"}
    data-progress-personal-updated-at={progress.dataUpdatedAt}
    data-progress-safety-updated-at={safety.dataUpdatedAt}>
    <span aria-label="Overall training completion">{percent}%</span>
    {safety.data && <><span aria-label="Company safety score" title={safety.data.incomplete ? "Safety assessment is incomplete" : "Combined company safety score"}>{safety.data.score}/{safety.data.maximum}</span><span aria-label="Safety bonus points">+{safety.data.bonus}</span></>}
  </span>;
}
export function CertificationProgress({
  profile = false,
  embedded = false,
}: {
  profile?: boolean;
  embedded?: boolean;
}) {
  const { repo, progress } = useTrainingProgress();
  const d = progress.data;
  if (!d) return progress.isError ? <p role="alert" data-progress-personal-state="error">Training progress is unavailable. Refresh to try again.</p> : embedded ? <p role="status" data-progress-personal-state="loading">Loading training…</p> : null;
  const items = d.certifications.filter((c) => !profile || (c.complete && !c.standalone && !c.groupingOnly));
  const certifications = items.filter((c) => !c.standalone);
  const standalone = items.filter((c) => c.standalone && !certifications.some((cert) =>
    cert.userId === c.userId && cert.steps.some((step) => step.id === c.id),
  ));
  const groups = [
    { title: "Certifications", items: certifications },
    { title: "Standalone Courses", items: standalone.length ? [{
      ...standalone[0],
      id: "standalone-courses",
      title: "Standalone Courses",
      complete: standalone.every((course) => course.complete),
      steps: standalone.flatMap((course) => course.steps),
    }] : [] },
  ].filter((group) => group.items.length > 0);
  if (!items.length && !(embedded && d.canViewTeamTraining)) return trainingProgressExperimentsEnabled ? <span hidden data-progress-personal-state={progress.isError ? "error" : progress.isFetching ? "loading" : "ready"} data-progress-team-required="false" /> : null;
  return (
    <section className={embedded ? "vendor-repository" : "vendor-repository space-y-3"}
      data-progress-personal-state={progress.isError ? "error" : progress.isFetching ? "loading" : "ready"}
      data-progress-personal-updated-at={progress.dataUpdatedAt}
      data-progress-team-required={embedded && d.canViewTeamTraining ? "true" : "false"}>
      {!embedded && <h2 className="flex gap-2 font-bold">
        <GraduationCap size={19} />
        {profile ? "My certifications" : "My training and certifications"}
      </h2>}
      {groups.map((group) => (
        <section key={group.title} aria-label={group.title} className={embedded ? "hub-training-group" : "space-y-3"}>
          {!profile && group.title !== "Standalone Courses" && <h3 className="font-bold">{group.title}</h3>}
      {group.items.map((c) => (
        <details className={embedded ? "hub-training-certificate" : "repository-card space-y-2"} key={c.id}>
          <summary className={embedded ? "hub-home-row hub-training-summary" : "cursor-pointer font-bold"}>
            {embedded && <GraduationCap aria-hidden="true" className="hub-row-icon" />}
            <span title={formatTrainingTitle(c.title)} className={embedded ? "hub-row-label" : "inline-flex w-[calc(100%-1.5rem)] items-center gap-2"}>
            {c.complete && <CheckCircle size={17} />} {formatTrainingTitle(c.title)}{" "}
            {c.augmented && <Layers size={16} aria-label="Vendor Augmented" />}
            {!embedded && <span className="ml-auto whitespace-nowrap text-sm">{completionPercent([c])}% complete</span>}
            </span>
            {embedded && <><span className="hub-row-value">{completionPercent([c])}%</span><ChevronRight aria-hidden="true" className="hub-chevron" /></>}
          </summary>
          <p>
            {c.steps.filter((s) => s.complete).length} / {c.steps.length}{" "}
            complete
          </p>
          {c.augmented && !c.complete && (
            <button
              className="repo-action"
              disabled={repo.pending}
              onClick={() =>
                void repo.save({
                  action: "renew",
                  payload: { augmentationId: c.id },
                })
              }
            >
              Prepare current course assignments
            </button>
          )}
          <ol aria-label={`${c.title} progress`} className="space-y-2">
            {c.steps.map((step, i) => (
              <li key={step.id} className="flex flex-wrap items-center gap-3 border-t border-[var(--brand-primary)] py-3">
                <span className="flex items-center gap-2" aria-current={!step.complete && i === c.steps.findIndex((s) => !s.complete) ? "step" : undefined}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-[var(--brand-primary)] font-bold">
                    {step.complete ? "✓" : i + 1}
                  </span>
                  <span>{step.complete ? "Completed" : i === c.steps.findIndex((s) => !s.complete) ? "Next step" : "Upcoming"}</span>
                </span>
                <a className="repo-action" href={step.href}>
                  {step.type === "course" ? formatTrainingTitle(step.title) : step.title}
                </a>
                {step.expiresAt && (
                  <span>
                    Valid until {new Date(step.expiresAt).toLocaleDateString()}
                  </span>
                )}
                {c.augmented && step.type === "material" && !step.complete && (
                  <button
                    className="repo-action"
                    disabled={repo.pending}
                    onClick={() =>
                      void repo.save({
                        action: "ack",
                        payload: {
                          augmentationId: c.id,
                          documentId: step.id,
                          confirmed: true,
                        },
                      })
                    }
                  >
                    Confirm completed
                  </button>
                )}
              </li>
            ))}
          </ol>
        </details>
      ))}
        </section>
      ))}
      {embedded && d.canViewTeamTraining && <TeamTrainingProgress />}
      {repo.error && <p role="alert">{repo.error}</p>}
    </section>
  );
}
export function VendorAugmented() {
  const repo = useRepository(),
    d = repo.data,
    [editing, setEditing] = useState<string | null>(null),
    [audience, setAudience] = useState<Audience>(emptyAudience),
    [title, setTitle] = useState(""),
    [base, setBase] = useState(""),
    [courses, setCourses] = useState<string[]>([]),
    [documents, setDocuments] = useState<string[]>([]),
    [months, setMonths] = useState(""),
    [source, setSource] = useState("");
  if (!d) return <p>{repo.error ?? "Loading…"}</p>;
  return (
    <section className="vendor-repository space-y-3">
      <h2 className="font-bold flex gap-2">
        <Layers size={18} />
        Vendor Augmented
      </h2>
      <p>
        VNDRLY/U requirements remain intact. Add courses and company materials
        for your people.
      </p>
      {d.canManageTraining && (
        <button
          className="repo-action"
          onClick={() => {
            setEditing("new");
            setTitle("");
            setBase("");
            setCourses([]);
            setDocuments([]);
            setAudience(emptyAudience);
          }}
        >
          <Plus size={16} />
          Augment a course or certification
        </button>
      )}
      {d.augmentations.map((a) => (
        <article className="repository-card" key={a.id}>
          <h3 className="font-bold flex gap-2">
            <Layers size={16} />
            {a.data.title}
          </h3>
          <p>
            Added {new Date(a.createdAt).toLocaleString()} by{" "}
            {d.creators.find((c) => c.id === a.createdBy)?.name ?? a.createdBy}
          </p>
          <details>
            <summary>View augmentation</summary>
            <ul>
              {((a.data.courseIds as string[]) ?? []).map((id) => (
                <li key={id}>
                  {d.courses.find((c) => c.id === id)?.title ?? "Course"}
                </li>
              ))}
              {((a.data.documentIds as string[]) ?? []).map((id) => (
                <li key={id}>
                  <a
                    className="repo-action"
                    href={`/api/work-hub/file-library/${id}/download`}
                  >
                    Supplemental material
                  </a>
                </li>
              ))}
            </ul>
            <p>
              {a.data.renewalMonths
                ? `Renewal: ${a.data.renewalMonths} months · ${a.data.renewalSource}`
                : "No fixed renewal interval designated."}
            </p>
          </details>
          {d.canManageTraining && (
            <button
              className="repo-action"
              onClick={() => {
                setEditing(a.id);
                setTitle(a.data.title);
                setBase(a.data.baseItemId);
                setCourses(a.data.courseIds ?? []);
                setDocuments(a.data.documentIds ?? []);
                setAudience(a.data.audience ?? emptyAudience);
                setMonths(
                  a.data.renewalMonths ? String(a.data.renewalMonths) : "",
                );
                setSource(a.data.renewalSource ?? "");
              }}
            >
              Edit additions and recipients
            </button>
          )}
        </article>
      ))}
      {editing && d.canManageTraining && (
        <form
          className="repository-card space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            await repo.save({
              action: "augment",
              version:
                d.augmentations.find((a) => a.id === editing)?.data.version ??
                null,
              payload: {
                ...(editing !== "new" ? { id: editing } : {}),
                title,
                baseItemId: base,
                courseIds: courses,
                documentIds: documents,
                required: true,
                renewalMonths: months ? Number(months) : null,
                renewalSource: source,
                audience,
              },
            });
            setEditing(null);
          }}
        >
          <label className="block">
            Title
            <input
              required
              className="w-full rounded border p-2"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="block">
            VNDRLY/U course / certification
            <select
              required
              className="w-full rounded border p-2"
              value={base}
              onChange={(e) => setBase(e.target.value)}
            >
              <option value="">Choose…</option>
              {d.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <details>
            <summary>Additional VNDRLY/U courses</summary>
            {d.courses
              .filter((c) => c.id !== base)
              .map((c) => (
                <OptionSwitch
                  key={c.id}
                  label={c.title}
                  value={courses.includes(c.id)}
                  onChange={(on) =>
                    setCourses(
                      on
                        ? [...courses, c.id]
                        : courses.filter((id) => id !== c.id),
                    )
                  }
                />
              ))}
          </details>
          <RepositoryAudience
            value={audience}
            onChange={setAudience}
            options={d.options}
          />
          <details>
            <summary>Renewal policy and source</summary>
            <p>
              Use the governing source and actual duties. Practical evaluations
              and course renewals are separate.
            </p>
            {d.renewalSources.map((r) => (
              <p key={r.id}>
                <a href={r.url} target="_blank" rel="noreferrer">
                  {r.label}
                </a>
                : {r.condition}
              </p>
            ))}
            <label>
              Vendor renewal interval (months)
              <input
                type="number"
                min="1"
                max="120"
                value={months}
                onChange={(e) => setMonths(e.target.value)}
              />
            </label>
            <label>
              Policy/source for this interval
              <input
                required={!!months}
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
            </label>
          </details>
          <button className="repo-action" disabled={repo.pending}>
            Save augmentation and assign
          </button>
          <button
            type="button"
            className="repo-action"
            onClick={() => setEditing(null)}
          >
            Cancel
          </button>
        </form>
      )}
      <CertificationProgress />
      {repo.error && <p role="alert">{repo.error}</p>}
    </section>
  );
}
export function VendorBonusScore() {
  const repo = useRepository(),
    d = repo.data;
  return (
    d && (
      <section className="vendor-repository repository-card">
        <h2 className="font-bold flex gap-2">
          <Layers size={18} />
          Vendor Augmented bonus
        </h2>
        <p>
          {d.bonusScore.toFixed(2)} / 10 bonus points · {d.bonusCompleted} /{" "}
          {d.bonusRequired} required augmented requirements complete.
        </p>
        <p>
          The VNDRLY base score remains out of 100. Maximum combined score: 110.
        </p>
      </section>
    )
  );
}

export function PartnerAugmentationSummary({ vendorId }: { vendorId: number }) {
  const { user } = useAuth(),
    [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: [
      "partner-vendor-augmentations",
      user?.userId,
      user?.activeMembershipId,
      vendorId,
    ],
    enabled: open,
    queryFn: () =>
      workHubRequest<any>(`/repository/vendor/${vendorId}/augmentations`),
  });
  return (
    <section className="vendor-repository repository-card">
      <button
        className="repo-action"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Layers size={17} />
        Vendor Augmented details
      </button>
      {open && (
        <>
          {query.isPending && <p>Loading augmentation details…</p>}
          {query.error && <p role="alert">{query.error.message}</p>}
          {query.data && (
            <>
              <p>{query.data.bonusScore.toFixed(2)} / 10 bonus</p>
              {query.data.certifications.map((c: any, index: number) => (
                <article className="repository-card" key={`${c.id}:${index}`}>
                  <h3>{c.title}</h3>
                  <p>{c.complete ? "Complete" : "Incomplete"}</p>
                  <ul>
                    {c.steps.map((s: any) => (
                      <li key={s.id}>
                        {s.title} · {s.complete ? "Complete" : "Incomplete"}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
