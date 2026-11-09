import { CardHeading } from "@/components/ui/card-heading";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Users } from "lucide-react";
import { BrandedInput, BrandedSelect } from "./chrome";
import { PngPillButton } from "@/components/png-pill-rollover";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { commandEnvelope, workHubRequest, type WorkHubOwner } from "@/lib/work-hub-client";
import { assignedWeekdayCells, assignmentConflicts, patternKey, shiftCell, type ScheduleData } from "./shift-assignment-model";
import { calendarDayFromSearch } from "@/lib/calendar-day-link";
import { useNextSteps } from "@/components/next-steps";
import { useGuidedTarget } from "@/components/guided-target";
import { gateGuideMatches, gateGuideScope } from "@/lib/gate-operational-helpers";
export type AdministrationMode = "define" | "assign" | "gaps";
// Reassignment confirmations stage changes; only the reviewed save writes them.
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function weekEnd() { const d = new Date(); d.setDate(d.getDate()+6); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
export function ShiftAssignments({ siteId, owner, mode }: { siteId: number; owner: WorkHubOwner; mode: "assign" | "gaps" }) {
  const cache = useQueryClient();
  const linked = new URLSearchParams(window.location.search), linkedShift=linked.get("shiftId");
  const validLinkedDay = calendarDayFromSearch(window.location.search);
  const [from, setFrom] = useState(()=>validLinkedDay??today()), [through, setThrough] = useState(()=>validLinkedDay??weekEnd()), [employee, setEmployee] = useState(()=>linked.get("employee")??"");
  const [cells, setCells] = useState<string[]>([]), [ids, setIds] = useState<string[]>([]), [review, setReview] = useState(false), [message, setMessage] = useState("");
  const [pending, setPending] = useState<ReturnType<typeof commandEnvelope> | null>(null), [saving, setSaving] = useState(false);
  const [removedCells, setRemovedCells] = useState<string[]>([]), [replacement, setReplacement] = useState("");
  const [transferCell, setTransferCell] = useState<string | null>(null);
  const [transferChoices, setTransferChoices] = useState<Record<string, number>>({});
  const [confirmedTransfers, setConfirmedTransfers] = useState<Record<string, number>>({});
  const [savedAssignment, setSavedAssignment] = useState(false);
  const helper = useNextSteps();
  const validRange = Boolean(from && through && through >= from && (Date.parse(through)-Date.parse(from))/86400000 < 93);
  const query = useQuery({ queryKey: ["site-shift-schedule", owner.type, owner.id, siteId, from, through], enabled: validRange, retry: false, refetchOnWindowFocus: false,
    queryFn: () => workHubRequest<ScheduleData>(`/site-shift-plans/${siteId}/schedule?type=${owner.type}&id=${owner.id}&from=${from}&through=${through}`) });
  const data = query.data;
  const available = (data?.shifts ?? []).filter(shift=>!linkedShift || shift.id===linkedShift);
  const assignedCells = assignedWeekdayCells(available, Number(employee));
  const gaps = available.filter(s => s.assignees.length < s.required);
  const patterns = [...new Map(available.map(s => [patternKey(s), s])).values()];
  const requested = available.filter(s => mode === "assign" ? cells.includes(shiftCell(s)) : ids.includes(s.id));
  const selected = requested.filter(s => !s.assignees.includes(Number(employee)));
  const removed = available.filter(s => removedCells.includes(shiftCell(s)) && s.assignees.includes(Number(employee)));
  const transfers = replacement ? removed.filter(s => !s.assignees.includes(Number(replacement))) : [];
  const conflicts = [...assignmentConflicts(selected, Number(employee), (data?.busy ?? []).filter(b => !(b.userId === Number(employee) && removed.some(s => s.id === b.shiftId)))), ...assignmentConflicts(transfers, Number(replacement), data?.busy ?? [])];
  const full = selected.filter(s => s.assignees.length >= s.required && !s.assignees.includes(confirmedTransfers[s.id]));
  const canReview = Boolean(employee && (selected.length || removed.length) && !conflicts.length && !full.length && !query.isFetching && !query.isError);
  const changes = [...selected.map(s => ({ id:s.id,version:s.version,addUserId:Number(employee),...(confirmedTransfers[s.id] ? {removeUserId:confirmedTransfers[s.id]} : {}) })), ...removed.map(s => ({ id:s.id,version:s.version,removeUserId:Number(employee),...(replacement && !s.assignees.includes(Number(replacement)) ? {addUserId:Number(replacement)} : {}) }))];
  const employeeName = (id:string) => data?.people.find(p => p.id === Number(id))?.name ?? available.find(s => s.assigneeNames?.[id])?.assigneeNames?.[id] ?? `Gatekeeper ${id}`;
  const transferRows = available.filter(s => shiftCell(s) === transferCell && !s.assignees.includes(Number(employee)) && s.assignees.length > 0);
  const guideContext = { siteId, stationId: linked.get("stationId") ?? undefined, shiftId: linkedShift, day: validLinkedDay ?? undefined };
  const formScope = gateGuideScope("assignment", guideContext), reviewScope = gateGuideScope("assignment-review", guideContext);
  const focusedShift = available.find(s => s.id === (linkedShift ?? helper?.selected?.context?.shiftId));
  const guided = gateGuideMatches(helper?.selected, "gate-shift-scheduling", guideContext) || gateGuideMatches(helper?.selected, "first-watch", guideContext) || !savedAssignment && gateGuideMatches(helper?.selected, "gate-staffing-recovery", guideContext);
  const target = !employee ? { scopeId: formScope, targetId: "employee", prompt: "Choose the eligible gatekeeper for this saved site and shift. Assignment will be reviewed before it is saved." } : review ? { scopeId: reviewScope, targetId: "save-assignments", prompt: "Review this exact shift, worker and any replacement, then save the assignment. This does not start a watch or restore actual coverage." } : changes.length ? { scopeId: reviewScope, targetId: "review-assignments", prompt: "Review the proposed saved shift assignments before committing any change." } : focusedShift ? { scopeId: reviewScope, targetId: `shift-${focusedShift.id}`, prompt: "Select this saved shift. An occupied shift requires explicit reassignment confirmation; nothing changes until reviewed and saved." } : null;
  useGuidedTarget(target, guided && !saving && !pending && !query.isError && !query.isFetching && navigator.onLine, 35);
  useGuidedTarget({ scopeId: `${reviewScope}:transfer`, targetId: "confirm-transfer", prompt: "Review who currently owns this shift and confirm the person to replace. This stages the transfer; the reviewed save still comes next." }, guided && transferCell !== null, 100);
  function clearDraft() { setCells([]); setIds([]); setRemovedCells([]); setReplacement(""); setTransferCell(null); setTransferChoices({}); setConfirmedTransfers({}); resetReview(); }
  function chooseCell(cell:string) {
    if (cells.includes(cell)) {
      setConfirmedTransfers(current => Object.fromEntries(Object.entries(current).filter(([id]) => !available.some(s => s.id === id && shiftCell(s) === cell))));
      toggle(cell,cells,setCells); return;
    }
    const occupied = available.filter(s => shiftCell(s) === cell && !s.assignees.includes(Number(employee)) && s.assignees.length > 0);
    if (occupied.length) {
      setTransferChoices(Object.fromEntries(occupied.filter(s => s.assignees.length === 1).map(s => [s.id,s.assignees[0]])));
      setTransferCell(cell); resetReview();
    } else toggle(cell,cells,setCells);
  }
  function resetReview() { setReview(false); setMessage(""); }
  function toggle(value: string, list: string[], set: (values: string[]) => void) { set(list.includes(value) ? list.filter(v => v !== value) : [...list, value]); resetReview(); }
  async function save() {
    if (!canReview || data?.readOnly || saving) return;
    const request = pending ?? commandEnvelope(owner, { changes });
    setPending(request); setSaving(true);
    try {
      await workHubRequest(`/site-shift-plans/${siteId}/assign`, { method: "POST", body: JSON.stringify(request) });
      setPending(null); clearDraft(); setMessage("Assignments saved."); void cache.invalidateQueries({queryKey:["account-next-steps"]}); const verified = await query.refetch();
      const savedShift = verified.data?.shifts.find(shift => changes.some(change => change.id === shift.id) && shift.assignees.length > 0);
      if (savedShift && !verified.isError) { setSavedAssignment(true); if (helper?.recordCompletion) void helper.recordCompletion("gate-shift-scheduling", { recordType: "gate-scheduled-shift", recordId: savedShift.id, siteId }); }
    } catch(error) {
      setMessage(error instanceof Error ? error.message : "Assignment was not confirmed.");
      if ([400,403,409,422].includes((error as {status?:number}).status ?? 0)) { setPending(null); setReview(false); await query.refetch(); }
    } finally { setSaving(false); }
  }
  return <>
    <AlertDialog open={transferCell !== null} onOpenChange={open => { if (!open) setTransferCell(null); }}>
      <AlertDialogContent data-guidance-scope={`${reviewScope}:transfer`}>
        <AlertDialogHeader><AlertDialogTitle>Reassign shift?</AlertDialogTitle></AlertDialogHeader>
        <AlertDialogDescription>This shift is already assigned to {Array.from(new Set(transferRows.flatMap(s => s.assignees.map(id => employeeName(String(id)))))).join(", ")}. Are you sure you want to transfer responsibility of this shift to {employeeName(employee)}?</AlertDialogDescription>
        <div className="max-h-60 overflow-y-auto space-y-3">{transferRows.map(s => <div key={s.id}><p>{s.date} · {s.pattern} · {s.starts}–{s.ends}</p>{s.assignees.length > 1 && <label>Gatekeeper to replace<BrandedSelect aria-label={`Gatekeeper to replace ${s.date}`} value={transferChoices[s.id] ?? ""} onChange={e => setTransferChoices(current => ({...current,[s.id]:Number(e.target.value)}))}><option value="">Choose a gatekeeper</option>{s.assignees.map(id => <option key={id} value={id}>{employeeName(String(id))}</option>)}</BrandedSelect></label>}</div>)}</div>
        <p className="text-sm">This stages the transfer for review. Nothing changes until you save.</p>
        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><PngPillButton data-guidance-id="confirm-transfer" color="brand" disabled={!transferRows.length || transferRows.some(s => !s.assignees.includes(transferChoices[s.id]))} onClick={() => { if (!transferCell) return; setConfirmedTransfers(current => ({...current,...transferChoices})); setCells(current => [...current,transferCell]); setTransferCell(null); resetReview(); }}>Yes Reassign Shift</PngPillButton></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <section data-guidance-scope={formScope} data-card-layout className="hub-shift-panel"><CardHeading as="h3"><CalendarDays aria-hidden="true" />{mode === "assign" ? "Recurring assignments" : "Coverage gaps"}</CardHeading>
      <fieldset disabled={Boolean(pending) || saving}>
        <div className="hub-assignment-dates"><label>From<BrandedInput aria-label="Schedule from" type="date" value={from} onChange={e => { setFrom(e.target.value); clearDraft(); }} /></label><label>Through<BrandedInput aria-label="Schedule through" type="date" value={through} onChange={e => { setThrough(e.target.value); clearDraft(); }} /></label></div>
        <label>Gatekeeper<BrandedSelect data-guidance-id="employee" aria-label="Assignment gatekeeper" value={employee} onChange={e => { setEmployee(e.target.value); clearDraft(); }}><option value="">Select a gatekeeper</option>{data?.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</BrandedSelect></label>
        {!!removed.length && <label>Assign unchecked shifts to<BrandedSelect aria-label="Replacement gatekeeper" value={replacement} onChange={e => { setReplacement(e.target.value); resetReview(); }}><option value="">Leave unassigned</option>{data?.people.filter(p => p.id !== Number(employee)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</BrandedSelect></label>}
      </fieldset>
      <p>{mode === "assign" ? "Select shifts for Sunday–Saturday. The selection repeats across the scheduled dates in this range." : "Shows scheduled shifts with fewer assigned people than required. Select the gaps to fill."} Times follow each site’s saved time zone.</p>
      <p>Only existing scheduled shifts are assigned. Dates without a scheduled shift are not generated by this form.</p>
      {!validRange && <p role="alert">Choose an ordered date range of up to 93 days.</p>}
      {query.isFetching && <p role="status">Loading schedule and gatekeepers…</p>}
      {query.isError && <p role="alert">Schedule could not load. <button type="button" onClick={() => void query.refetch()}>Retry</button></p>}
      {data && !data.people.length && <p>No active gatekeepers with access to this site were found.</p>}
      {data?.readOnly && <p role="status">Local preview: review assignments here; saving is disabled to protect the existing schedule.</p>}
    </section>
    {data && <section data-guidance-scope={reviewScope} data-card-layout className="hub-shift-panel hub-shift-rows"><CardHeading as="h3"><Users aria-hidden="true" />{mode === "assign" ? "Weekly responsibilities" : "Unfilled scheduled shifts"}</CardHeading>
      <fieldset disabled={Boolean(pending) || saving}>
      {mode === "assign" ? <><p>Checked days show saved assignments. Uncheck a day to remove it or transfer it to another gatekeeper. Changes are reviewed before saving.</p><div className="hub-assignment-table"><table><thead><tr><th>Shift</th>{days.map(day => <th key={day}>{day}</th>)}</tr></thead><tbody>{patterns.map(p => <tr key={patternKey(p)}><th>{p.pattern}<small>{p.starts}–{p.ends} · {p.timezone}</small></th>{days.map((day, weekday) => { const cell = `${patternKey(p)}|${weekday}`; const exists = available.some(s => shiftCell(s) === cell); const assigned = assignedCells.has(cell); return <td key={day}><input data-guidance-id={focusedShift && shiftCell(focusedShift) === cell ? `shift-${focusedShift.id}` : undefined} type="checkbox" aria-label={`${p.pattern} ${day}`} title={assigned ? "Already assigned" : undefined} disabled={!exists || !employee} checked={assigned ? !removedCells.includes(cell) : cells.includes(cell)} onChange={() => assigned ? toggle(cell,removedCells,setRemovedCells) : chooseCell(cell)} /></td>; })}</tr>)}</tbody></table></div></>
        : <div className="hub-gap-list">{gaps.map(s => <label key={s.id}><input type="checkbox" checked={ids.includes(s.id)} onChange={() => toggle(s.id,ids,setIds)} aria-label={`Fill ${s.pattern} ${s.date}`} /><span><strong>{s.pattern}</strong><br />{s.date} · {s.starts}–{s.ends} · {s.timezone}<br />{s.required - s.assignees.length} needed · {s.assignees.length}/{s.required} assigned</span></label>)}</div>}
      </fieldset>
      {!available.length && <p>No scheduled shifts exist in this date range.</p>}
      {mode === "gaps" && available.length > 0 && !gaps.length && <p>All scheduled shifts in this date range meet their required staffing.</p>}
      {!!conflicts.length && <p role="alert">Double-booking prevented: {conflicts.length} selected shift(s) overlap this gatekeeper’s schedule or each other. Change the gatekeeper or selection.</p>}
      {!!full.length && <p role="alert">{full.length} selected shift(s) are already fully staffed. Unselect those days or narrow the dates.</p>}
      {!!requested.length && <p>{selected.length} new assignment(s); {requested.length-selected.length} already assigned to this gatekeeper.</p>}
      {!!removed.length && <p>{removed.length} assignment(s) will be {replacement ? `transferred from ${employeeName(employee)} to ${employeeName(replacement)}` : `removed from ${employeeName(employee)}, leaving coverage gaps`} after review and save.</p>}
      {!review ? <PngPillButton data-guidance-id="review-assignments" color="brand" disabled={!canReview} onClick={() => setReview(true)}>Review assignments</PngPillButton> : <div className="hub-assignment-review"><h4>Review assignment changes</h4><ul>{selected.map(s => <li key={s.id}>{confirmedTransfers[s.id] ? `Transfer ${employeeName(String(confirmedTransfers[s.id]))} → ${employeeName(employee)}` : `Assign ${employeeName(employee)}`}: {s.date} · {s.pattern} · {s.starts}–{s.ends}</li>)}{removed.map(s => <li key={s.id}>{replacement ? `Transfer ${employeeName(employee)} → ${employeeName(replacement)}` : `Remove ${employeeName(employee)} — leave unassigned`}: {s.date} · {s.pattern} · {s.starts}–{s.ends}</li>)}</ul><p>Site access, availability, qualifications and schedule conflicts are checked again before saving. All changes succeed together or none are saved.</p><PngPillButton color="brand" disabled={saving || Boolean(pending)} onClick={() => setReview(false)}>Back to editing</PngPillButton><PngPillButton data-guidance-id="save-assignments" color="brand" disabled={!canReview || saving || data.readOnly} onClick={() => void save()}>{saving ? "Saving…" : pending ? "Retry same assignment" : "Save assignments"}</PngPillButton></div>}
      {message && <p role="status">{message}</p>}{helper?.enabled && <button type="button" className="gate-watch-text-action" onClick={() => helper.startHelper("gate-shift-scheduling", guideContext)}>Guide these shift assignments</button>}
    </section>}
  </>;
}
