import { useQuery } from "@tanstack/react-query";
import { workHubRequest } from "@/lib/work-hub-client";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import { GraduationCap, Layers, CheckCircle, Plus } from "lucide-react";
import { useRepository } from "./repository-client";
import {
  RepositoryAudience,
  emptyAudience,
  type Audience,
} from "./repository-audience";
import OptionSwitch from "./library/option-switch";
import "./repository-theme.css";
export function CertificationProgress({
  profile = false,
}: {
  profile?: boolean;
}) {
  const repo = useRepository(),
    d = repo.data;
  if (!d) return null;
  const items = d.certifications.filter((c) => !profile || c.complete);
  if (!items.length) return null;
  return (
    <section className="vendor-repository space-y-3">
      <h2 className="flex gap-2 font-bold">
        <GraduationCap size={19} />
        My certifications
      </h2>
      {items.map((c) => (
        <article className="repository-card space-y-2" key={c.id}>
          <h3 className="flex gap-2 font-bold">
            {c.complete && <CheckCircle size={17} />} {c.title}{" "}
            {c.augmented && <Layers size={16} aria-label="Vendor Augmented" />}
          </h3>
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
          <ol className="space-y-2">
            {c.steps.map((step, i) => (
              <li key={step.id} className="flex flex-wrap gap-2 items-center">
                <span>
                  {step.complete ? "✓" : "○"} {i + 1}.
                </span>
                <a className="repo-action" href={step.href}>
                  {step.title}
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
        </article>
      ))}
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
