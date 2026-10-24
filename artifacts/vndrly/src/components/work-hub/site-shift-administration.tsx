import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListSiteLocations, useListVendors, useListPartners } from "@workspace/api-client-react";
import { siteShiftPlanSchema, shiftMinutes, type SiteShiftPlan, type SiteShiftRow } from "@workspace/api-zod";
import { Settings2, MapPin, Clock3, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { commandEnvelope, isWorkHubAdmin, ownerForUser, workHubRequest, type WorkHubOwner } from "@/lib/work-hub-client";
import { PngPillButton } from "@/components/png-pill-rollover";
import { WorkspacePanel } from "./workspace-panel";
import { BrandedInput, BrandedSelect } from "./chrome";
import "./site-shift-administration.css";
import { ShiftAssignments, type AdministrationMode } from "./shift-assignments";
import { CoverageGaps } from "./coverage-gaps";

type SavedPlan = SiteShiftPlan & { revision: string };
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const initial: SiteShiftPlan = { mode: "part_time", shifts: [{ startsAtLocal: "08:00", endsAtLocal: "16:00", requiredCount: 1, weekdays: [1, 2, 3, 4, 5] }] };
const time = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export default function SiteShiftAdministration() {
  const { user } = useAuth();
  const [mode, setMode] = useState<AdministrationMode>("define");
  if (!isWorkHubAdmin(user)) return null;
  const owner = ownerForUser(user);
  return <WorkspacePanel title="Administrative functions" subtitle="Weekly site staffing and shift definitions" icon={Settings2} actions={<BrandedSelect aria-label="Administrative function" value={mode} onChange={event => setMode(event.target.value as AdministrationMode)}><option value="define">Set/Edit a recurring shift</option><option value="assign">Assign a recurring shift</option><option value="gaps">Coverage gaps</option></BrandedSelect>}>
    {owner ? <SitePlanner key={`${user?.userId}:${user?.activeMembershipId}:${owner.type}:${owner.id}:${mode}`} owner={owner} mode={mode} /> : user?.role === "admin" ? <AdminCompanyPlanner mode={mode} /> : <p className="p-4">Select a company workspace to manage its site shifts.</p>}
  </WorkspacePanel>;
}
function AdminCompanyPlanner({ mode }: { mode: AdministrationMode }) {
  const vendors = useListVendors(), partners = useListPartners();
  const [selection, setSelection] = useState("");
  const [type, id] = selection.split(":");
  return <><div className="hub-shift-admin"><section className="hub-shift-panel"><label>Company<BrandedSelect aria-label="Company" value={selection} onChange={event => setSelection(event.target.value)}><option value="">Select a company</option>
    {partners.data?.map(company => <option key={`partner:${company.id}`} value={`partner:${company.id}`}>Partner · {company.name}</option>)}
    {vendors.data?.map(company => <option key={`vendor:${company.id}`} value={`vendor:${company.id}`}>Vendor · {company.name}</option>)}
  </BrandedSelect></label></section></div>{selection && <SitePlanner key={`${selection}:${mode}`} owner={{ type: type as WorkHubOwner["type"], id: Number(id) }} mode={mode} />}</>;
}
function SitePlanner({ owner, mode }: { owner: WorkHubOwner; mode: AdministrationMode }) {
  const { user } = useAuth();
  const sites = useListSiteLocations(owner.type === "partner" ? { partnerId: owner.id } : undefined);
  const scopedSites = useQuery({ queryKey: ["work-hub", "staffing-sites", user?.userId, user?.activeMembershipId, owner.type, owner.id], retry: false,
    queryFn: async () => {
      try { return (await workHubRequest<{ sites: { id: number; name: string }[] }>(`/site-shift-plans?type=${owner.type}&id=${owner.id}`)).sites; }
      catch (error) {
        if ((error as { status?: number }).status !== 404 || owner.type !== "vendor" || user?.vendorId !== owner.id) throw error;
        // Existing Gate contracts can expose sites absent from the partner catalog.
        const response = await fetch("/api/gate-change-over/station-management/sites", { credentials: "include" });
        if (!response.ok) throw error;
        return ((await response.json()) as { sites: { id: number; name: string }[] }).sites;
      }
    },
  });
  const availableSites = scopedSites.data ?? sites.data ?? [];
  const [siteId, setSiteId] = useState("");
  if (mode === "gaps") return <CoverageGaps owner={owner} />;
  return <div className="hub-shift-admin">
    <section className="hub-shift-panel"><h3><MapPin aria-hidden="true" />Site</h3>
      <label>Site location<BrandedSelect aria-label="Site location" value={siteId} onChange={event => setSiteId(event.target.value)}><option value="">Select a site</option>{availableSites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</BrandedSelect></label>
      {sites.isLoading && <p role="status">Loading sites…</p>}
      {sites.isError && <p role="alert">Sites could not load. Refresh the page to try again.</p>}
      {!sites.isLoading && !scopedSites.isPending && !availableSites.length && <p role="status">No sites are currently available for this company.</p>}
      <p>Times use the site’s local clock. Selected days are the days each shift starts. An end time earlier than the start ends the following day.</p>
    </section>
    {siteId ? mode === "define" ? <PlanEditor key={siteId} siteId={Number(siteId)} owner={owner} /> : <ShiftAssignments key={`${siteId}:${mode}`} siteId={Number(siteId)} owner={owner} mode={mode} /> : <section className="hub-shift-panel"><h3><Clock3 aria-hidden="true" />Coverage &amp; shifts</h3><p>Choose a site to {mode === "define" ? "define or edit its weekly staffing" : mode === "assign" ? "assign its recurring shifts" : "review its coverage gaps"}.</p></section>}
  </div>;
}
function PlanEditor({ owner, siteId }: { owner: WorkHubOwner; siteId: number }) {
  const [plan, setPlan] = useState<SiteShiftPlan>(initial), [revision, setRevision] = useState<string | null>(null);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<ReturnType<typeof commandEnvelope> | null>(null);
  const query = useQuery({ queryKey: ["work-hub", "site-shift-plan", owner.type, owner.id, siteId], retry: false,
    queryFn: async () => {
      const result = await workHubRequest<SavedPlan>(`/site-shift-plans/${siteId}?type=${owner.type}&id=${owner.id}`);
      // Do not replace edits during background refreshes.
      return result;
    }, refetchOnWindowFocus: false,
  });
  const loaded = revision !== null;
  useEffect(() => { if (query.data && revision === null) load(); }, [query.data]);
  function load() {
    if (!query.data) return;
    setPlan(query.data.shifts.length ? { mode: query.data.mode, shifts: query.data.shifts } : initial);
    setRevision(query.data.revision); setMessage("");
  }
  function update(index: number, patch: Partial<SiteShiftRow>) {
    setPlan(current => ({ ...current, shifts: current.shifts.map((row, i) => i === index ? { ...row, ...patch } : row) })); setMessage("");
  }
  function distribute(count: number) {
    if (!Number.isInteger(count) || count < 1 || count > 4) return;
    const first = plan.shifts[0];
    const start = Number(first.startsAtLocal.slice(0, 2)) * 60 + Number(first.startsAtLocal.slice(3));
    setPlan({ mode: "24_hour", shifts: Array.from({ length: count }, (_, i) => ({ startsAtLocal: time(start + Math.round(i * 1440 / count)), endsAtLocal: time(start + Math.round((i + 1) * 1440 / count)), requiredCount: first.requiredCount, weekdays: [...first.weekdays] })) });
  }
  const validation = siteShiftPlanSchema.safeParse(plan);
  async function save() {
    if (busy || !revision || !validation.success) return;
    const request = attempt ?? commandEnvelope(owner, { revision, plan: validation.data });
    setAttempt(request); setBusy(true); setMessage("");
    try {
      const result = await workHubRequest<{ resource: SavedPlan }>(`/site-shift-plans/${siteId}`, { method: "PUT", body: JSON.stringify(request) });
      setRevision(result.resource.revision); setPlan({ mode: result.resource.mode, shifts: result.resource.shifts }); setAttempt(null); setMessage("Weekly shift definitions saved.");
    } catch (error) {
      if ((error as { status?: number }).status === 409) { setAttempt(null); setRevision(null); void query.refetch(); }
      setMessage(error instanceof Error ? error.message : "Save was not confirmed. Retry the same save.");
    } finally { setBusy(false); }
  }
  return <>
    <section className="hub-shift-panel"><h3><Clock3 aria-hidden="true" />Coverage pattern</h3>
      {plan.shifts.some(row => row.patternName) && <label>Saved shift patterns<BrandedSelect aria-label="Saved shift patterns" defaultValue="" onChange={event => document.getElementById(`site-shift-${siteId}-${event.target.value}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}><option value="">Choose a saved pattern</option>{plan.shifts.map((row, index) => row.patternName && <option key={index} value={index}>{row.patternName}</option>)}</BrandedSelect></label>}
      {query.isPending && <p role="status">Loading saved shifts…</p>}
      {query.isError && <p role="alert">Saved shift definitions are unavailable. You can preview the form below, but saving stays disabled until the scheduling API is available.</p>}
      {query.data && !loaded && <PngPillButton color="blue" onClick={load}>{query.data.shifts.length ? "Edit saved shifts" : "Define shifts"}</PngPillButton>}
      <fieldset disabled={busy || Boolean(attempt)}>
        <label>Coverage<BrandedSelect aria-label="Coverage" value={plan.mode} onChange={event => event.target.value === "24_hour" ? distribute(3) : setPlan({ ...plan, mode: "part_time" })}><option value="part_time">Part-time / selected hours</option><option value="24_hour">24-hour staffing</option></BrandedSelect></label>
        {plan.mode === "24_hour" && <label>Shifts per coverage day<BrandedSelect aria-label="Shifts per coverage day" value={plan.shifts.length} onChange={event => distribute(Number(event.target.value))}>{Array.from({ length: 4 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</BrandedSelect></label>}
        <p>{plan.mode === "24_hour" ? "Changing the shift count splits 24 hours evenly from the first start time. Adjust each shift below." : "Add the time windows and number of people needed at this site."}</p>
      </fieldset>
    </section>
    <section className="hub-shift-panel hub-shift-rows"><h3><Users aria-hidden="true" />Shift definitions</h3>
      <fieldset disabled={busy || Boolean(attempt)}>{plan.shifts.map((row, index) => <div className="hub-shift-row" id={`site-shift-${siteId}-${index}`} key={index}>
        <h4>{row.patternName || `Shift ${index + 1}`} <small>{shiftMinutes(row) / 60} hrs{row.endsAtLocal <= row.startsAtLocal ? " · ends next day" : ""}</small></h4>
        <label>Pattern name<BrandedInput aria-label={`Shift ${index + 1} pattern name`} value={row.patternName ?? ""} maxLength={200} onChange={event => update(index, { patternName: event.target.value || undefined })} /></label>{row.timezone && <p>Timezone: {row.timezone}</p>}<div className="hub-shift-times"><label>Start time<BrandedInput aria-label={`Shift ${index + 1} start time`} type="time" value={row.startsAtLocal} onChange={event => update(index, { startsAtLocal: event.target.value })} /></label>
          <label>End time<BrandedInput aria-label={`Shift ${index + 1} end time`} type="time" value={row.endsAtLocal} onChange={event => update(index, { endsAtLocal: event.target.value })} /></label>
          <label>People needed<BrandedInput aria-label={`Shift ${index + 1} people needed`} type="number" min={1} max={500} value={row.requiredCount || ""} onChange={event => update(index, { requiredCount: Number(event.target.value) })} /></label></div>
        <div className="hub-shift-days" role="group" aria-label={`Shift ${index + 1} repeat days`}>{days.map((day, dayIndex) => <label key={day}><input type="checkbox" checked={row.weekdays.includes(dayIndex)} onChange={event => update(index, { weekdays: event.target.checked ? [...row.weekdays, dayIndex].sort() : row.weekdays.filter(value => value !== dayIndex) })} />{day}</label>)}</div>
        {plan.mode === "part_time" && plan.shifts.length > 1 && <PngPillButton color="red" onClick={() => setPlan({ ...plan, shifts: plan.shifts.filter((_, i) => i !== index) })}>Remove shift {index + 1}</PngPillButton>}
      </div>)}
      {plan.mode === "part_time" && <PngPillButton color="blue" disabled={plan.shifts.length >= 24} onClick={() => setPlan({ ...plan, shifts: [...plan.shifts, { ...initial.shifts[0], weekdays: [...initial.shifts[0].weekdays] }] })}>Add shift</PngPillButton>}
      </fieldset>
      {!validation.success && <p role="alert">{validation.error.issues[0].message}</p>}
      <p>Repeats weekly. Saves staffing requirements only; employees are assigned separately.</p>
      <PngPillButton color="brand" disabled={!loaded || busy || !validation.success} onClick={() => void save()}>{busy ? "Saving…" : attempt ? "Retry same save" : "Save weekly shifts"}</PngPillButton>
      {message && <p role="status">{message}</p>}
    </section>
  </>;
}



