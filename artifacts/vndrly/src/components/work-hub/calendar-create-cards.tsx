import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import BrandPillButton from "@/components/brand-pill-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BrandedSelect } from "@/components/work-hub/chrome";
import { WorkspacePanel } from "./workspace-panel";
import "./calendar-create-cards.css";
import Picker from "./calendar-assignee-picker";
import { FormattedDateTimeInput, parseTaskDateTime } from "./formatted-date-time-input";
import {
  commandEnvelope,
  createWorkHubOperationId,
  workHubRequest,
} from "@/lib/work-hub-client";

type Row = Record<string, any>;
type Owner = { type: "vendor" | "partner"; id: number };

async function gateRequest<T>(path: string): Promise<T> {
  const response = await fetch(`/api/gate-change-over${path}`, { credentials: "include" });
  if (!response.ok) throw new Error("Could not load Gate scheduling options");
  return response.json();
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-sm font-medium"><span>{label}</span>{children}</label>;
}


async function expandedUsers(userIds: number[], crewIds: string[]) {
  const members = await Promise.all(
    crewIds.map((crewId) => workHubRequest(`/crews/${crewId}/members`) as Promise<Row[]>),
  );
  return [...new Set([...userIds, ...members.flat().map((member) => Number(member.userId)).filter(Boolean)])];
}

export default function CalendarCreateCards({ owner }: { owner: Owner | null }) {
  const qc = useQueryClient();
  const people = useQuery<Row[]>({ queryKey: ["work-hub", "calendar-people"], queryFn: () => workHubRequest("/people") });
  const crews = useQuery<Row[]>({ queryKey: ["work-hub", "calendar-crews"], queryFn: () => workHubRequest("/crews") });
  const meetingTypes = useQuery<Row[]>({ queryKey: ["work-hub", "meeting-types"], queryFn: () => workHubRequest("/scheduling/types") });
  const [form, setForm] = useState({
    kind: "shift",
    meetingType: "",
    title: "",
    startsAt: "",
    endsAt: "",
    userIds: [] as number[],
    crewIds: [] as string[],
    mandatory: false,
    notes: "",
    shiftType: "standard",
    siteLocationId: "",
    gateStationId: "",
    requiredStaffCount: "1",
    workStartPolicy: "on_site",
  });
  const gateSites = useQuery<{ sites: Row[] }>({
    queryKey: ["gate-change-over", "sites"],
    queryFn: () => gateRequest("/sites"),
    enabled: form.kind === "shift" && form.shiftType === "gate",
  });
  const gateStations = useQuery<{ stations: Row[] }>({
    queryKey: ["gate-change-over", "stations", form.siteLocationId],
    queryFn: () => gateRequest(`/stations?siteId=${form.siteLocationId}`),
    enabled: form.kind === "shift" && form.shiftType === "gate" && Boolean(form.siteLocationId),
  });
  const durationMinutes = useMemo(() => {
    const start = parseTaskDateTime(form.startsAt)?.getTime() ?? NaN;
    const end = parseTaskDateTime(form.endsAt)?.getTime() ?? NaN;
    return Number.isFinite(start) && Number.isFinite(end) && end > start
      ? Math.max(5, Math.round((end - start) / 60_000))
      : 60;
  }, [form.endsAt, form.startsAt]);
  const createItem = useMutation({
    mutationFn: async () => {
      if (!owner) throw new Error("Choose a company before creating Calendar work.");
      const attendeeIds = await expandedUsers(form.userIds, form.crewIds);
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (form.kind === "event") {
        const typed = form.meetingType.trim();
        const exists = meetingTypes.data?.some((item) => item.title.toLowerCase() === typed.toLowerCase());
        if (typed && !exists) {
          await workHubRequest("/scheduling/types", {
            method: "POST",
            body: JSON.stringify({
              operationId: createWorkHubOperationId(),
              title: typed,
              description: "",
              durationMinutes,
              timezone,
              visibility: "shared",
              active: true,
            }),
          });
        }
        return workHubRequest("/meetings", {
          method: "POST",
          body: JSON.stringify(commandEnvelope(owner, {
            title: form.title,
            agenda: [
              typed ? `Meeting type: ${typed}` : "",
              form.mandatory ? "Mandatory attendance." : "",
              form.notes,
            ].filter(Boolean).join("\n\n"),
            startsAt: parseTaskDateTime(form.startsAt)!.toISOString(),
            endsAt: parseTaskDateTime(form.endsAt)!.toISOString(),
            timezone,
            recordingAllowed: false,
            participantUserIds: attendeeIds,
          })),
        });
      }
      return workHubRequest("/shifts", {
        method: "POST",
        body: JSON.stringify(commandEnvelope(owner, {
          title: form.title,
          startsAt: parseTaskDateTime(form.startsAt)!.toISOString(),
          endsAt: parseTaskDateTime(form.endsAt)!.toISOString(),
          timezone,
          open: false,
          assigneeUserIds: attendeeIds,
          qualificationCodes: [],
          calendarType: "company",
          instructions: [form.mandatory ? "Mandatory attendance." : "", form.notes].filter(Boolean).join("\n\n") || null,
          ...(form.shiftType === "gate" ? {
            siteLocationId: Number(form.siteLocationId),
            gateStationId: form.gateStationId,
            requiredStaffCount: Number(form.requiredStaffCount),
            workStartPolicy: form.workStartPolicy,
          } : {}),
        })),
      });
    },
    onSuccess: () => {
      setForm((current) => ({ ...current, title: "", meetingType: "", startsAt: "", endsAt: "", userIds: [], crewIds: [], mandatory: false, notes: "", gateStationId: "" }));
      qc.invalidateQueries({ queryKey: ["work-hub", "calendar"] });
      qc.invalidateQueries({ queryKey: ["work-hub", "meeting-types"] });
    },
  });
  const commonClass = "grid gap-3 [&_input:not([type=checkbox])]:rounded-full [&_input:not([type=checkbox])]:border-2 [&_input:not([type=checkbox])]:border-[color:var(--brand-primary)] [&_input:not([type=checkbox])]:bg-white [&_select]:h-10 [&_select]:rounded-full [&_select]:border-2 [&_select]:border-[color:var(--brand-primary)] [&_select]:bg-white [&_select]:px-3";
  return (
    <div id="create-shift-card" data-testid="calendar-create-card-row">
      <WorkspacePanel title="Schedule work" subtitle="Create shifts and meetings for your company." icon={CalendarDays}>
        <div className="hub-schedule-body">
          <form aria-label="Create Shift/Event" className={`hub-schedule-form ${commonClass}`} onSubmit={(event) => { event.preventDefault(); createItem.mutate(); }}>
            <h3><CalendarDays aria-hidden="true" />Create Shift/Event</h3>
            <div className="hub-schedule-fields">
            <Field label="Work type">
              <BrandedSelect aria-label="Work type" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
                <option value="shift">Shift</option>
                <option value="event">Event or meeting</option>
              </BrandedSelect>
            </Field>
            {form.kind === "shift" && <Field label="Shift type">
              <BrandedSelect aria-label="Shift type" value={form.shiftType} onChange={(event) => setForm({ ...form, shiftType: event.target.value })}>
                <option value="standard">Standard shift</option>
                <option value="gate">Gate shift</option>
              </BrandedSelect>
            </Field>}
            </div>
            {form.kind === "shift" && form.shiftType === "gate" && <fieldset className="hub-schedule-section"><legend>Gate coverage</legend><div className="hub-schedule-fields">
              <Field label="Gate site">
                <BrandedSelect aria-label="Gate site" value={form.siteLocationId} onChange={(event) => setForm({ ...form, siteLocationId: event.target.value, gateStationId: "" })} required>
                  <option value="">Choose site</option>
                  {(gateSites.data?.sites ?? []).map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                </BrandedSelect>
              </Field>
              <Field label="Gate station">
                <BrandedSelect aria-label="Gate station" value={form.gateStationId} onChange={(event) => setForm({ ...form, gateStationId: event.target.value })} required>
                  <option value="">Choose gate</option>
                  {(gateStations.data?.stations ?? []).map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
                </BrandedSelect>
              </Field>
              <Field label="Required gatekeepers"><Input aria-label="Required gatekeepers" type="number" min="1" max="20" value={form.requiredStaffCount} onChange={(event) => setForm({ ...form, requiredStaffCount: event.target.value })} required /></Field>
              <Field label="Work start policy">
                <BrandedSelect aria-label="Work start policy" value={form.workStartPolicy} onChange={(event) => setForm({ ...form, workStartPolicy: event.target.value })}>
                  <option value="on_site">Start work on site</option>
                  <option value="paid_travel">Paid travel starts work</option>
                </BrandedSelect>
              </Field>
            </div></fieldset>}
            {form.kind === "event" && <Field label="Meeting Type">
              <Input list="calendar-meeting-types" value={form.meetingType} onChange={(event) => setForm({ ...form, meetingType: event.target.value })} placeholder="Type or create a meeting type" />
              <datalist id="calendar-meeting-types">{meetingTypes.data?.map((type) => <option key={type.id} value={type.title} />)}</datalist>
            </Field>}
            <Field label="Title"><Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required /></Field>
            <fieldset className="hub-schedule-section"><legend>When</legend><div className="hub-schedule-fields">
            <Field label="Starts"><FormattedDateTimeInput value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} required /></Field>
            <Field label="Ends"><FormattedDateTimeInput value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} required /></Field>
            </div></fieldset>
            <Picker people={people.data ?? []} crews={crews.data ?? []} userIds={form.userIds} crewIds={form.crewIds} onUsers={(userIds) => setForm({ ...form, userIds })} onCrews={(crewIds) => setForm({ ...form, crewIds })} />
            <fieldset className="hub-schedule-section"><legend>Options</legend>
            <Field label="Calendar"><BrandedSelect aria-label="Calendar" value="company" disabled><option value="company">Internal company</option></BrandedSelect></Field>
            <Field label="Notes"><Textarea className="rounded-xl border-2 border-[color:var(--brand-primary)] bg-white" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm font-semibold"><input className="h-4 w-4 rounded border-2 border-[color:var(--brand-primary)] bg-white accent-[var(--brand-primary)]" style={{ colorScheme: "light", accentColor: "var(--brand-primary)" }} type="checkbox" checked={form.mandatory} onChange={(event) => setForm({ ...form, mandatory: event.target.checked })} />Mandatory</label>
            </fieldset>
            {createItem.error && <p role="alert" className="text-sm text-red-700">{createItem.error instanceof Error ? createItem.error.message : "Unable to create Calendar work."}</p>}
            <BrandPillButton type="submit" tone="brand" disabled={!owner || createItem.isPending}>{createItem.isPending ? "Creating…" : "Create Shift/Event"}</BrandPillButton>
          </form>

        </div>
      </WorkspacePanel>
    </div>
  );
}
