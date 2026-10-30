import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CalendarPlus } from "lucide-react";
import { useBrand } from "@/hooks/use-brand";
import { Dialog } from "@/components/ui/dialog";
import { VendorEditFlyout } from "@/components/vendor-edit-flyout";
import { BrandedCheckbox } from "@/components/branded-checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BrandedSelect } from "./chrome";
import Picker from "./calendar-assignee-picker";
import { FormattedDateTimeInput, parseTaskDateTime } from "./formatted-date-time-input";
import { commandEnvelope, workHubRequest, type WorkHubOwner } from "@/lib/work-hub-client";
import "./calendar-create-cards.css";

type Row = Record<string, any>;
type Definition = { id: string; version: number; stationId: string; siteName: string; gateName: string; startsAtLocal: string; endsAtLocal: string; timezone: string; weekdays: number[]; requiredCount: number; notes: string; watches: { id: string; startsAt: string; endsAt: string; people: { id: number; name: string }[] }[] };
type Options = { gates: { id: string; name: string; siteName: string }[]; definitions: Definition[] };
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const initial = () => ({ stationIds: [] as string[], startsAtLocal: "06:00", endsAtLocal: "18:00", weekdays: [0,1,2,3,4,5,6], timezone: "America/Chicago", requiredCount: 1, notes: "", userIds: [] as number[], crewIds: [] as string[] });
const clockLabel = (clock: string) => { const [h,m] = clock.split(":").map(Number); return `${String(h % 12 || 12).padStart(2,"0")}:${String(m).padStart(2,"0")} ${h >= 12 ? "PM" : "AM"}`; };
const when = (value: string, timezone: string) => { const date = new Date(value); const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "2-digit", day: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hour12: true }).formatToParts(date).filter(item => item.type !== "literal").map(item => [item.type,item.value])); return `${parts.month}/${parts.day}/${parts.year} ${parts.hour}:${parts.minute} ${parts.dayPeriod}`; };
const toggled = <T,>(items: T[], value: T) => items.includes(value) ? items.filter(item => item !== value) : [...items,value];

export default function GateCalendarScheduling({ owner, canDefine = true }: { owner: WorkHubOwner; canDefine?: boolean }) {
  const [open, setOpen] = useState<"define" | "event" | null>(null);
  const [selected, setSelected] = useState("");
  const [definition, setDefinition] = useState(initial);
  const [event, setEvent] = useState({ title: "", startsAt: "", endsAt: "", notes: "", userIds: [] as number[], crewIds: [] as string[] });
  const brand = useBrand(), qc = useQueryClient();
  const options = useQuery<Options>({ queryKey: ["work-hub", "gate-shift-definitions", owner.id], queryFn: () => workHubRequest(`/gate-shift-definitions?vendorId=${owner.id}`), enabled: open === "define", refetchOnWindowFocus: false, retry: false });
  const people = useQuery<Row[]>({ queryKey: ["work-hub", "calendar-people", owner], queryFn: () => workHubRequest("/people"), enabled: !!open });
  const crews = useQuery<Row[]>({ queryKey: ["work-hub", "calendar-crews", owner], queryFn: () => workHubRequest("/crews"), enabled: !!open });
  const saved = options.data?.definitions.find(row => row.id === selected);
  const refresh = () => { setOpen(null); for (const name of ["calendar", "gate-shift-definitions", "home", "staffing-sites"]) void qc.invalidateQueries({ queryKey: ["work-hub", name] }); void qc.invalidateQueries({ queryKey: ["site-shift-schedule"] }); };
  const deletion = useMutation({ mutationFn: () => {
    if (!saved) throw new Error("Choose a saved shift first.");
    return workHubRequest("/gate-shift-definitions/retire", { method: "POST", body: JSON.stringify(commandEnvelope(owner, { id: saved.id, version: saved.version })) });
  }, onSuccess: refresh });
  function choose(id: string) {
    setSelected(id); mutation.reset(); deletion.reset();
    const item = options.data?.definitions.find(row => row.id === id);
    setDefinition(item ? { ...initial(), stationIds: [item.stationId], startsAtLocal: item.startsAtLocal, endsAtLocal: item.endsAtLocal, weekdays: [...item.weekdays], timezone: item.timezone, requiredCount: item.requiredCount, notes: item.notes ?? "" } : initial());
  }
  const mutation = useMutation({ mutationFn: async () => {
    if (open === "define") return workHubRequest("/gate-shift-definitions", { method: "POST", body: JSON.stringify(commandEnvelope(owner, { ...definition, ...(saved ? { id: saved.id, version: saved.version } : {}) })) });
    const start = parseTaskDateTime(event.startsAt), end = parseTaskDateTime(event.endsAt);
    if (!start || !end || end <= start) throw new Error("Enter a valid start and a later end using MM/DD/YY hh:mm AM/PM.");
    const members = await Promise.all(event.crewIds.map(id => workHubRequest(`/crews/${id}/members`) as Promise<Row[]>));
    return workHubRequest("/meetings", { method: "POST", body: JSON.stringify(commandEnvelope(owner, {
      title: event.title.trim(), agenda: event.notes, startsAt: start.toISOString(), endsAt: end.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      participantUserIds: [...new Set([...event.userIds, ...members.flat().map(member => Number(member.userId)).filter(Boolean)])], recordingAllowed: false, calendarEvent: true,
    })) });
  }, onSuccess: refresh });
  const busy = mutation.isPending || deletion.isPending;
  const close = () => { if (!busy) { setOpen(null); mutation.reset(); deletion.reset(); } };
  const launch = (mode: "define" | "event") => { setSelected(""); setDefinition(initial()); setEvent({ title: "", startsAt: "", endsAt: "", notes: "", userIds: [], crewIds: [] }); mutation.reset(); deletion.reset(); setOpen(mode); };
  const submit = <button className="vendor-mini-card-button" type="submit" disabled={busy || open === "define" && (options.isPending || options.isError || !definition.stationIds.length || !definition.weekdays.length)}>{mutation.isPending ? "Saving…" : open === "define" ? saved ? "Save Shift" : "Create Shift" : "Add Event"}</button>;
  const formClass = "hub-schedule-form hub-task-flyout-form grid gap-3";
  return <>
    {canDefine && <button type="button" className="hub-task-mini-card" onClick={() => launch("define")}><CalendarDays size={16} aria-hidden="true" />Add/Edit Shifts</button>}
    <button type="button" className="hub-task-mini-card" onClick={() => launch("event")}><CalendarPlus size={16} aria-hidden="true" />Add Event</button>
    <Dialog open={!!open} onOpenChange={value => { if (!value) close(); }}><VendorEditFlyout title={open === "define" ? "Add/Edit Shifts" : "Add Event"} logoSrc={brand.logoSquareUrl || brand.logoUrl || undefined} logoAlt={`${brand.name} logo`} onClose={close}>
      <form aria-label={open === "define" ? "Add/Edit Shifts" : "Add Event"} className={formClass} onSubmit={e => { e.preventDefault(); mutation.mutate(); }}>
      <fieldset disabled={busy} className="grid gap-3">
        {open === "define" ? <>
          <label className="grid gap-1">Shift<BrandedSelect value={selected} onChange={e => choose(e.target.value)} disabled={options.isPending || options.isError}><option value="">Create New Shift</option>{options.data?.definitions.map(item => <option key={item.id} value={item.id}>{item.siteName} | {item.gateName} · {clockLabel(item.startsAtLocal)}–{clockLabel(item.endsAtLocal)}</option>)}</BrandedSelect></label>
          {options.isPending && <p role="status">Loading defined shifts…</p>}
          {options.isError && <p role="alert">Shift definitions could not load. <button type="button" onClick={() => void options.refetch()}>Retry</button></p>}
          <fieldset className="hub-schedule-section"><legend>Gates</legend><div className="gate-definition-gates">{options.data?.gates.map(gate => <label key={gate.id}><BrandedCheckbox checked={definition.stationIds.includes(gate.id)} disabled={!!saved} onCheckedChange={() => setDefinition({ ...definition, stationIds: toggled(definition.stationIds, gate.id) })} />{gate.siteName} | {gate.name}</label>)}</div></fieldset>
          <div className="hub-schedule-fields"><label className="grid gap-1">Starts<BrandedSelect value={definition.startsAtLocal} onChange={e => setDefinition({ ...definition, startsAtLocal: e.target.value })}>{Array.from({ length: 96 }, (_, index) => { const time = `${String(Math.floor(index/4)).padStart(2,"0")}:${String(index%4*15).padStart(2,"0")}`; return <option key={time} value={time}>{clockLabel(time)}</option>; })}</BrandedSelect></label><label className="grid gap-1">Ends<BrandedSelect value={definition.endsAtLocal} onChange={e => setDefinition({ ...definition, endsAtLocal: e.target.value })}>{Array.from({ length: 96 }, (_, index) => { const time = `${String(Math.floor(index/4)).padStart(2,"0")}:${String(index%4*15).padStart(2,"0")}`; return <option key={time} value={time}>{clockLabel(time)}</option>; })}</BrandedSelect></label></div>
          <p className="hub-task-flyout-hint">{definition.endsAtLocal <= definition.startsAtLocal ? "Ends the following day. " : ""}Times use {definition.timezone}.</p>
          <fieldset className="hub-schedule-section"><legend>Repeats weekly</legend><div className="gate-definition-days">{days.map((day,index) => <label key={day}><BrandedCheckbox checked={definition.weekdays.includes(index)} onCheckedChange={() => setDefinition({ ...definition, weekdays: toggled(definition.weekdays,index) })} />{day}</label>)}</div></fieldset>
          <label className="grid gap-1">Gatekeepers required<Input type="number" min={1} max={20} value={definition.requiredCount} onChange={e => setDefinition({ ...definition, requiredCount: Number(e.target.value) })} required /></label>
          <p className="hub-task-flyout-hint">Assignment is optional. Existing scheduled watches keep their saved times and people. Selected people apply only to newly created watches; later watches can be filled from the roster.</p>
          <Picker people={people.data ?? []} crews={crews.data ?? []} userIds={definition.userIds} crewIds={definition.crewIds} onUsers={userIds => setDefinition({ ...definition, userIds })} onCrews={crewIds => setDefinition({ ...definition, crewIds })} />
          <label className="grid gap-1">Notes<Textarea value={definition.notes} onChange={e => setDefinition({ ...definition, notes: e.target.value })} /></label>
          {saved && <details><summary>Scheduled watches · {saved.watches.length}</summary><ul className="gate-definition-watches">{saved.watches.map(watch => <li key={watch.id}><a href={`/work-hub/calendar?date=${new Intl.DateTimeFormat("en-CA", { timeZone: saved.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(watch.startsAt))}`}>{when(watch.startsAt,saved.timezone)}</a><span>{watch.people.map(person => person.name).join(", ") || "Unassigned"}</span></li>)}</ul></details>}
        </> : <>
          <label className="grid gap-1">Title<Input required maxLength={200} value={event.title} onChange={e => setEvent({ ...event, title: e.target.value })} /></label>
          <div className="hub-schedule-fields"><label className="grid gap-1">Starts<FormattedDateTimeInput required value={event.startsAt} onChange={e => setEvent({ ...event, startsAt: e.target.value })} /></label><label className="grid gap-1">Ends<FormattedDateTimeInput required value={event.endsAt} onChange={e => setEvent({ ...event, endsAt: e.target.value })} /></label></div>
          <Picker people={people.data ?? []} crews={crews.data ?? []} userIds={event.userIds} crewIds={event.crewIds} onUsers={userIds => setEvent({ ...event, userIds })} onCrews={crewIds => setEvent({ ...event, crewIds })} />
          <label className="grid gap-1">Notes<Textarea value={event.notes} onChange={e => setEvent({ ...event, notes: e.target.value })} /></label>
          <p className="hub-task-flyout-hint">One-time event or meeting.</p>
        </>}
      </fieldset>
      {mutation.error && <p role="alert">{mutation.error instanceof Error ? mutation.error.message : "Save could not be confirmed."}</p>}
      {deletion.error && <p role="alert">{deletion.error instanceof Error ? deletion.error.message : "Delete could not be confirmed."}</p>}
      {open === "define" && saved && <p className="hub-task-flyout-hint">Delete Shift stops this repeating definition. Existing scheduled watches and history are kept.</p>}
      <div className="gate-definition-actions">
        {open === "define" && saved && submit}
        <button type="button" className="vendor-mini-card-button" disabled={busy} onClick={close}>Cancel</button>
        {open === "define" && saved ? <button type="button" className="vendor-mini-card-button" disabled={busy} onClick={() => deletion.mutate()}>{deletion.isPending ? "Deleting…" : "Delete Shift"}</button> : submit}
      </div>
      </form>
    </VendorEditFlyout></Dialog>
  </>;
}
