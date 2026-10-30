import { CardHeading } from "@/components/ui/card-heading";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { BrandedSelect } from "./chrome";
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
import WorkdayStatusSwitch from "@/components/workday-status-switch";
import { VendorEditFlyout } from "@/components/vendor-edit-flyout";
import "@/components/workday-controls.css";
import { useBrand } from "@/hooks/use-brand";
const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const clock = (value: string) => { const [h,m]=value.split(':').map(Number); return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`; };
function gapSummary(gap: CoverageGap) {
  if (!gap.shift) return "Needs shift setup";
  const [year,month,day]=gap.shift.date.split('-');
  const status=gap.id.includes('vacancy:')?`${gap.required} open`:gap.detail;
  return `${month}/${day}/${year.slice(-2)} · ${clock(gap.shift.starts)}–${clock(gap.shift.ends)} · ${status}`;
}
export function CoverageGaps({ owner }: { owner: WorkHubOwner }) {
  const brand = useBrand();
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const [from] = useState(() => localDay(new Date())),
    [through] = useState(() => {
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
  const [reassigning, setReassigning] = useState(false);
  const [decisionAttempt,setDecisionAttempt]=useState<{decision:'approved'|'declined';envelope:ReturnType<typeof commandEnvelope>}|null>(null);
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
    refetchInterval: 15000,
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
  const candidates = useQuery({
    queryKey: ["coverage-candidates", owner.type, owner.id, chosen?.shift?.id, chosen?.shift?.version, chosen?.originalUserId, kind],
    enabled: Boolean(chosen?.shift && chosen.requestStatus!=='pending' && (!chosen.awaitingAcknowledgment || reassigning)), retry: false,
    queryFn: () => workHubRequest<{people:{id:number;name:string;pickupExtraShifts:boolean}[];truncated:boolean}>(
      `/site-shift-plans/coverage-candidates?type=${owner.type}&id=${owner.id}&shiftId=${chosen!.shift!.id}&kind=${kind}${chosen?.originalUserId ? `&originalUserId=${chosen.originalUserId}` : ""}`),
  });
  const people = candidates.isSuccess && !candidates.isFetching ? candidates.data.people : [];
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
    chosen.requestStatus!=='pending' &&
    worker &&
    people.some(p=>p.id === Number(worker)) &&
    effectiveShifts.length &&
    !conflicts.length &&
    query.isSuccess &&
    !query.isFetching,
  );
  function reset() {
    setFlyoutOpen(false);
    setSelectedId("");
    setWorker("");
    setReview(false);
    setAttempt(null);
    setMessage("");
  }
  function openGap(gap: CoverageGap) {
    if (saving || ((attempt || decisionAttempt) && selectedId !== gap.id)) return;
    if (!attempt && !decisionAttempt) {
      setSelectedId(gap.id); setWorker(""); setKind("temporary");
      setReview(false); setReassigning(false); setMessage("");
    }
    setFlyoutOpen(true);
  }
  function closeFlyout() { if (!saving) setFlyoutOpen(false); }
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
      setCategory("Awaiting acknowledgment");
      setMessage("Assigned — awaiting gatekeeper acknowledgment.");
      await query.refetch();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save not confirmed.");
    } finally {
      setSaving(false);
    }
  }
  async function decide(decision:'approved'|'declined'){
    if(!chosen?.requestId||!chosen.shift||saving||query.data?.readOnly)return;
    if(decisionAttempt&&decisionAttempt.decision!==decision)return;
    const envelope=decisionAttempt?.envelope??commandEnvelope(owner,{requestId:chosen.requestId,shiftId:chosen.shift.id,decision});
    setDecisionAttempt({decision,envelope});setSaving(true);setMessage('');
    try{
      await workHubRequest('/site-shift-plans/decide-shift-off',{method:'POST',body:JSON.stringify(envelope)});
      setDecisionAttempt(null);setWorker('');setReview(false);
      setMessage(decision==='approved'?'Approved — select a replacement.':'Shift-off request declined.');
      await query.refetch();
    }catch{setMessage('Decision not confirmed. Retry the same decision.');}finally{setSaving(false);}
  }
  return (
    <div className="hub-shift-admin hub-coverage-inline">
      <div className="hub-shift-panel hub-coverage-content">
        <fieldset disabled={saving}>
          <p className="hub-coverage-period">Next 7 Days</p>
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
                      expanded={category === c} onClick={() => { if (!attempt&&!decisionAttempt) setCategory(category === c ? null : c); }} />
                    {category === c && <div className="hub-inline-panel hub-task-list" role="region" aria-label={`${c} details`}>
                    {!rows.length && query.isSuccess && (
                      <p>No recorded gaps in this category.</p>
                    )}
                    {rows.map((g) => (
                      <div key={g.id} className="hub-coverage-entry">
                      <div className="hub-coverage-choice">
                        <div className="hub-coverage-entry-heading">
                          <button type="button" className="hub-coverage-title" aria-haspopup="dialog" disabled={saving||Boolean((attempt||decisionAttempt)&&selectedId!==g.id)} onClick={()=>openGap(g)}><strong>{g.title}</strong></button>
                          <button type="button" className="hub-coverage-assign-link" aria-haspopup="dialog" disabled={saving||Boolean((attempt||decisionAttempt)&&selectedId!==g.id)} onClick={()=>openGap(g)}>(Re)Assign</button>
                        </div>
                        <span className="hub-coverage-summary" title={gapSummary(g)}>{gapSummary(g)}</span>
                      </div>
                      {selectedId === g.id && chosen && <Dialog.Root open={flyoutOpen} onOpenChange={open=>{if(!open)closeFlyout();}}><VendorEditFlyout title="(Re)Assign Coverage" className="coverage-assignment-flyout" logoSrc={brand.logoSquareUrl||brand.logoUrl||undefined} logoAlt={`${brand.name} logo`} onClose={closeFlyout}>
                      <div data-card-layout id={`coverage-editor-${g.id}`} className="hub-gap-editor hub-shift-panel" role="region" aria-label={`Assign coverage for ${g.title}`}>
                        <CardHeading as="h3">{g.title}</CardHeading>
                        {g.shift&&<p>{gapSummary(g)} · {g.shift.timezone}</p>}
                        {!g.shift ? <p>Use Set/Edit a recurring shift to define this gate’s staffing first.</p> : <>
                          {g.requestStatus==='pending'&&<div className="hub-gap-assignment-row">
                            <PngPillButton color="brand" disabled={query.data?.readOnly||Boolean(decisionAttempt&&decisionAttempt.decision!=='approved')} onClick={()=>void decide('approved')}>{decisionAttempt?.decision==='approved'?'Retry approval':'Approve'}</PngPillButton>
                            <PngPillButton color="brand" disabled={query.data?.readOnly||Boolean(decisionAttempt&&decisionAttempt.decision!=='declined')} onClick={()=>void decide('declined')}>{decisionAttempt?.decision==='declined'?'Retry decline':'Decline'}</PngPillButton>
                          </div>}
                          {g.awaitingAcknowledgment && <div className="hub-gap-assignment-row">
                            <PngPillButton color="brand" onClick={()=>{window.location.href=`/work-hub/calls?person=${g.originalUserId}`;}}>Call</PngPillButton>
                            <PngPillButton color="brand" onClick={()=>{window.location.href=`/work-hub/chat?person=${g.originalUserId}`;}}>Chat</PngPillButton>
                            <PngPillButton color="brand" disabled={Boolean(attempt||decisionAttempt)} onClick={()=>setReassigning(!reassigning)}>{reassigning?'Cancel':'Reassign'}</PngPillButton>
                          </div>}
                          {g.requestStatus!=='pending'&&(!g.awaitingAcknowledgment || reassigning) && <>
                          <div className="hub-gap-assignment-row">
                            <div className="hub-gap-kind hub-gap-scope-toggle" role="group" aria-label="Coverage replacement type">
                              <button type="button" aria-pressed={kind==='temporary'} disabled={Boolean(attempt||decisionAttempt)||saving} onClick={()=>{setKind('temporary');setWorker('');setReview(false);}}>TEMP</button>
                              <WorkdayStatusSwitch active={kind==='permanent'} label="" accessibilityLabel="TEMP / PERM" disabled={Boolean(attempt||decisionAttempt)||saving} onClick={()=>{setKind(kind==='temporary'?'permanent':'temporary');setWorker('');setReview(false);}}/>
                              <button type="button" aria-pressed={kind==='permanent'} disabled={Boolean(attempt||decisionAttempt)||saving} onClick={()=>{setKind('permanent');setWorker('');setReview(false);}}>PERM</button>
                            </div>
                            <p className="hub-gap-scope">{kind==='temporary'?'This shift only':'Recurring assignment from this shift onward'}</p>
                            <div className="hub-gap-worker">
                              <label htmlFor={`coverage-worker-${g.id}`}>Select Gatekeeper</label>
                              <BrandedSelect id={`coverage-worker-${g.id}`} aria-label="Coverage replacement gatekeeper" value={worker} disabled={Boolean(attempt)||candidates.isFetching||!candidates.isSuccess} className={people.find(p=>p.id===Number(worker))?.pickupExtraShifts ? "hub-pickup-priority" : undefined} onChange={e=>{setWorker(e.target.value);setReview(false);}}>
                                <option value="">Select a gatekeeper</option>
                                {people.map(p=><option key={p.id} value={p.id} className={p.pickupExtraShifts?'hub-pickup-priority':undefined}>{p.name}</option>)}
                              </BrandedSelect>
                            </div>
                          </div>
                          {candidates.isFetching && <p role="status">Loading gatekeepers…</p>}
                          {candidates.isError && <p role="alert">Gatekeepers could not load. <button type="button" onClick={()=>void candidates.refetch()}>Retry</button></p>}
                          {candidates.isSuccess&&!candidates.isFetching&&!people.length && <p role="status">No gatekeepers fit this schedule.</p>}
                          {!!conflicts.length && <p role="alert">This gatekeeper has a schedule conflict.</p>}
                          {review && chosen.originalUserId && <div className="hub-gap-transfer" role="group" aria-label="Confirm shift transfer">
                            <p>This shift is assigned to {g.shift.assigneeNames?.[String(chosen.originalUserId)] ?? schedule?.people.find(p=>p.id===chosen.originalUserId)?.name ?? 'another gatekeeper'}. Transfer responsibility to {people.find(p=>p.id===Number(worker))?.name}?</p>
                            <PngPillButton color="brand" disabled={Boolean(attempt)||saving} onClick={()=>setReview(false)}>Cancel</PngPillButton>
                            <PngPillButton color="brand" disabled={!canReview||query.data?.readOnly||saving} onClick={()=>void save()}>{saving?'Saving…':attempt?'Retry transfer':'Yes Reassign Shift'}</PngPillButton>
                          </div>}
                          </>}
                        </>}
                        {message&&<p role="status">{message}</p>}
                        <div className="hub-gap-actions">
                          {g.shift&&g.requestStatus!=='pending'&&(!g.awaitingAcknowledgment||reassigning)&&<PngPillButton color="brand" disabled={!canReview||query.data?.readOnly||saving} onClick={()=>chosen.originalUserId?setReview(true):void save()}>{saving?'Assigning…':attempt?'Retry (Re)Assign':'(Re)Assign'}</PngPillButton>}
                          <PngPillButton color="brand" disabled={saving} onClick={closeFlyout}>Cancel</PngPillButton>
                        </div>
                      </div></VendorEditFlyout></Dialog.Root>}
                      </div>
                    ))}
                    </div>}
                  </section>
                );
              })}
          </div>
        </fieldset>
      </div>
      {query.data?.readOnly && <p role="status">Read-only preview: assignments are not saved.</p>}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
