import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Users } from "lucide-react";
import { BrandedInput, BrandedSelect } from "./chrome";
import { PngPillButton } from "@/components/png-pill-rollover";
import { WorkspaceRow } from "./workspace-panel";
import {
  workHubRequest,
  type WorkHubOwner,
  commandEnvelope,
} from "@/lib/work-hub-client";
import {
  classifyCoverage,
  coverageCategories,
  type CoverageFacts,
  type CoverageGap,
} from "./coverage-gap-model";
import {
  assignmentConflicts,
  type ScheduleData,
} from "./shift-assignment-model";
const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function CoverageGaps({ owner }: { owner: WorkHubOwner }) {
  const [from, setFrom] = useState(() => localDay(new Date())),
    [through, setThrough] = useState(() => {
      const d = new Date();
      d.setDate(d.getDate() + 6);
      return localDay(d);
    });
  const [category, setCategory] = useState<string | null>(null),
    [selectedId, setSelectedId] = useState(""),
    [worker, setWorker] = useState(""),
    [kind, setKind] = useState("temporary"),
    [review, setReview] = useState(false),
    [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false),
    [attempt, setAttempt] = useState<ReturnType<typeof commandEnvelope> | null>(
      null,
    );
  const valid = Boolean(
    from &&
    through &&
    through >= from &&
    Date.parse(through) - Date.parse(from) < 93 * 86400000,
  );
  const query = useQuery({
    queryKey: ["coverage-board", owner.type, owner.id, from, through],
    enabled: valid,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { sites } = await workHubRequest<{
        sites: { id: number; name: string }[];
      }>(`/site-shift-plans?type=${owner.type}&id=${owner.id}`);
      const facts = await workHubRequest<CoverageFacts>(
        `/site-shift-plans/coverage-facts?type=${owner.type}&id=${owner.id}&from=${from}&through=${through}`,
      );
      const schedules = await Promise.all(
        sites.map(async (site) => ({
          site,
          data: await workHubRequest<ScheduleData>(
            `/site-shift-plans/${site.id}/schedule?type=${owner.type}&id=${owner.id}&from=${from}&through=${through}`,
          ),
        })),
      );
      const gaps: CoverageGap[] = schedules.flatMap(({ site, data }) =>
        data.shifts.length
          ? classifyCoverage(site.id, site.name, data.shifts, facts)
          : [
              {
                id: `unscheduled:${site.id}`,
                category: "New / Unassigned Recurring Shifts" as const,
                siteId: site.id,
                siteName: site.name,
                shift: null,
                title: site.name,
                detail:
                  "No dated shifts in this range. Define and schedule coverage before assigning a gatekeeper.",
                required: 0,
              },
            ],
      );
      return { gaps, schedules, readOnly: facts.readOnly };
    },
  });
  const chosen = query.data?.gaps.find((g) => g.id === selectedId);
  const schedule = query.data?.schedules.find(
    (s) => s.site.id === chosen?.siteId,
  )?.data;
  const people =
    schedule?.people.filter(
      (p) =>
        p.id !== chosen?.originalUserId &&
        !chosen?.shift?.assignees.includes(p.id),
    ) ?? [];
  const effectiveShifts = chosen?.shift
    ? kind === "temporary"
      ? [chosen.shift]
      : (schedule?.shifts ?? []).filter(
          (s) =>
            s.pattern === chosen.shift!.pattern &&
            s.starts === chosen.shift!.starts &&
            s.ends === chosen.shift!.ends &&
            s.weekday === chosen.shift!.weekday &&
            s.date >= chosen.shift!.date &&
            (!chosen.originalUserId ||
              s.assignees.includes(chosen.originalUserId)),
        )
    : [];
  const conflicts = assignmentConflicts(
    effectiveShifts,
    Number(worker),
    schedule?.busy ?? [],
  );
  const canReview = Boolean(
    chosen?.shift &&
    worker &&
    effectiveShifts.length &&
    !conflicts.length &&
    query.isSuccess &&
    !query.isFetching,
  );
  function reset() {
    setSelectedId("");
    setWorker("");
    setReview(false);
    setAttempt(null);
    setMessage("");
  }
  async function save() {
    if (!canReview || query.data?.readOnly || saving) return;
    setSaving(true);
    const envelope =
      attempt ??
      commandEnvelope(owner, {
        gapId: chosen!.id,
        shiftId: chosen!.shift!.id,
        expectedVersion: chosen!.shift!.version,
        replacementUserId: Number(worker),
        originalUserId: chosen!.originalUserId ?? null,
        requestId: chosen!.requestId ?? null,
        kind,
        effectiveDate: chosen!.shift!.date,
      });
    setAttempt(envelope);
    try {
      await workHubRequest("/site-shift-plans/coverage-resolution", {
        method: "POST",
        body: JSON.stringify(envelope),
      });
      reset();
      setMessage("Coverage resolution saved.");
      await query.refetch();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save not confirmed.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="hub-shift-admin">
      <section className="hub-shift-panel">
        <h3>
          <CalendarDays aria-hidden="true" />
          Unfilled scheduled shifts
        </h3>
        <fieldset disabled={saving || Boolean(attempt)}>
          <div className="hub-assignment-dates">
            <label>
              From
              <BrandedInput
                type="date"
                aria-label="Coverage from"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  reset();
                }}
              />
            </label>
            <label>
              Through
              <BrandedInput
                type="date"
                aria-label="Coverage through"
                value={through}
                onChange={(e) => {
                  setThrough(e.target.value);
                  reset();
                }}
              />
            </label>
          </div>
          {!valid && <p role="alert">Choose a date range of up to 93 days.</p>}
          {query.isFetching && (
            <p role="status">Loading coverage across all sites…</p>
          )}
          {query.isError && (
            <p role="alert">
              Coverage could not load completely.{" "}
              <button onClick={() => void query.refetch()}>Retry</button>
            </p>
          )}
          <div className="hub-coverage-list">
            {coverageCategories.map((c) => {
                const rows =
                  query.data?.gaps.filter((g) => g.category === c) ?? [];
                return (
                  <section className="hub-task-group" key={c}>
                    <WorkspaceRow icon={CalendarDays} label={c}
                      value={query.isError ? "Unavailable" : !query.data ? "Loading…" : `${rows.length} total`}
                      expanded={category === c} onClick={() => setCategory(category === c ? null : c)} />
                    {category === c && <div className="hub-inline-panel hub-task-list" role="region" aria-label={`${c} details`}>
                    {!rows.length && query.isSuccess && (
                      <p>No recorded gaps in this category.</p>
                    )}
                    {rows.map((g) => (
                      <button
                        type="button"
                        key={g.id}
                        aria-pressed={selectedId === g.id}
                        className="hub-coverage-choice"
                        onClick={() => {
                          setSelectedId(g.id);
                          setWorker("");
                          setKind(
                            g.category === "Permanent vacancies" ||
                              g.category === "New / Unassigned Recurring Shifts"
                              ? "permanent"
                              : "temporary",
                          );
                          setReview(false);
                          setMessage("");
                        }}
                      >
                        <strong>
                          {g.siteName} · {g.title}
                        </strong>
                        <span>
                          {g.shift
                            ? `${g.shift.date} · ${g.shift.starts}–${g.shift.ends}`
                            : "Needs shift setup"}
                        </span>
                        {g.shift && g.category === "New / Unassigned Recurring Shifts" && <span>Needs gatekeeper</span>}
                        <span>{g.detail}</span>
                      </button>
                    ))}
                    </div>}
                  </section>
                );
              })}
          </div>
        </fieldset>
      </section>
      <section className="hub-shift-panel">
        <h3>
          <Users aria-hidden="true" />
          Coverage Resolution
        </h3>
        {!chosen ? (
          <p>Select a coverage gap on the left.</p>
        ) : (
          <>
            <h4>
              {chosen.siteName} · {chosen.title}
            </h4>
            <p>{chosen.detail}</p>
            {chosen.originalUserId && <p>Currently assigned: {chosen.shift?.assigneeNames?.[String(chosen.originalUserId)] ?? schedule?.people.find(p=>p.id===chosen.originalUserId)?.name ?? "Assigned gatekeeper"}</p>}
            {chosen.shift && (
              <>
                <fieldset disabled={saving || Boolean(attempt)}>
                  <label>
                    Replacement type
                    <BrandedSelect
                      aria-label="Coverage replacement type"
                      value={kind}
                      onChange={(e) => {
                        setKind(e.target.value);
                        setReview(false);
                      }}
                    >
                      <option value="temporary">Temporary</option>
                      <option value="permanent">Permanent</option>
                    </BrandedSelect>
                  </label>
                  <label>
                    Gatekeeper
                    <BrandedSelect
                      aria-label="Coverage replacement gatekeeper"
                      value={worker}
                      onChange={(e) => {
                        setWorker(e.target.value);
                        setReview(false);
                      }}
                    >
                      <option value="">Select a gatekeeper</option>
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </BrandedSelect>
                  </label>
                </fieldset>
                <p>
                  {kind === "temporary"
                    ? "Covers this dated shift only. The original recurring responsibility is preserved."
                    : `Changes this ${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][chosen.shift.weekday]} responsibility from ${chosen.shift.date} onward, including matching future shifts beyond the displayed range. Existing earlier shifts stay unchanged.`}
                </p>
                {!!conflicts.length && (
                  <p role="alert">
                    This gatekeeper has overlapping assignments. Choose another
                    gatekeeper.
                  </p>
                )}
                {!review ? (
                  <PngPillButton
                    color="brand"
                    disabled={!canReview}
                    onClick={() => setReview(true)}
                  >
                    Review coverage
                  </PngPillButton>
                ) : (
                  <>
                    <h4>Review coverage resolution</h4>
                    <p>
                      {kind === "temporary"
                        ? "Temporary cover"
                        : "Permanent replacement"}
                      : {people.find((p) => p.id === Number(worker))?.name}
                    </p>
                    <p>
                      {chosen.shift.date} · {chosen.shift.starts}–
                      {chosen.shift.ends} · {chosen.shift.timezone}
                    </p>
                    <PngPillButton
                      color="brand"
                      disabled={saving || Boolean(attempt)}
                      onClick={() => setReview(false)}
                    >
                      Back to editing
                    </PngPillButton>
                    <PngPillButton
                      color="brand"
                      disabled={!canReview || query.data?.readOnly || saving}
                      onClick={() => void save()}
                    >
                      {saving
                        ? "Saving…"
                        : attempt
                          ? "Retry same resolution"
                          : "Save coverage resolution"}
                    </PngPillButton>
                  </>
                )}
              </>
            )}
            {!chosen.shift && (
              <p>
                Use Set/Edit a recurring shift to define the gate’s staffing
                first.
              </p>
            )}
          </>
        )}
        {query.data?.readOnly && (
          <p role="status">
            Local read-only preview: resolutions and requests are not submitted
            to the live schedule.
          </p>
        )}
        {message && <p role="status">{message}</p>}
      </section>
    </div>
  );
}
