import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckSquare2 } from "lucide-react";
import BrandPillButton from "@/components/brand-pill-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WorkHubCardTitle } from "@/components/work-hub/chrome";
import SplitToggleHalf from "@/components/split-toggle-half";
import { useBrand } from "@/hooks/use-brand";
import { pickTogglePillSrc, splitToggleDividerClass, TOGGLE_IDLE_PILL_SRC } from "@/lib/pick-toggle-pill";
import {
  commandEnvelope,
  createWorkHubOperationId,
  workHubRequest,
} from "@/lib/work-hub-client";

type Row = Record<string, any>;
type Owner = { type: "vendor" | "partner"; id: number };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-sm font-medium"><span>{label}</span>{children}</label>;
}

function Picker({
  people,
  crews,
  userIds,
  crewIds,
  onUsers,
  onCrews,
}: {
  people: Row[];
  crews: Row[];
  userIds: number[];
  crewIds: string[];
  onUsers: (ids: number[]) => void;
  onCrews: (ids: string[]) => void;
}) {
  const [mode, setMode] = useState<"crews" | "individuals">("crews");
  const brand = useBrand();
  const activePillSrc = pickTogglePillSrc(brand.primary, brand.name);
  const toggle = <T,>(values: T[], value: T) =>
    values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  return (
    <div className="grid gap-2 rounded-2xl border-2 border-[color:var(--brand-primary)] bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Assign attendees</p>
        <div className="inline-flex items-stretch overflow-hidden rounded-full" data-testid="calendar-assignee-toggle">
          <SplitToggleHalf side="left" active={mode === "crews"} pillSrc={mode === "crews" ? activePillSrc : TOGGLE_IDLE_PILL_SRC} onClick={() => setMode("crews")} aria-pressed={mode === "crews"}>Crews</SplitToggleHalf>
          <span aria-hidden className={`w-px shrink-0 self-stretch ${splitToggleDividerClass("light")}`} />
          <SplitToggleHalf side="right" active={mode === "individuals"} pillSrc={mode === "individuals" ? activePillSrc : TOGGLE_IDLE_PILL_SRC} onClick={() => setMode("individuals")} aria-pressed={mode === "individuals"}>Individuals</SplitToggleHalf>
        </div>
      </div>
      <div className="grid h-36 content-start gap-2 overflow-y-auto pr-1">
        {mode === "crews" ? crews.map((crew) => (
          <label key={crew.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={crewIds.includes(crew.id)} onChange={() => onCrews(toggle(crewIds, crew.id))} />
            {crew.name}
          </label>
        )) : people.map((person) => (
          <label key={person.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={userIds.includes(person.id)} onChange={() => onUsers(toggle(userIds, person.id))} />
            {person.displayName || person.email}
          </label>
        ))}
        {mode === "crews" && !crews.length && <p className="text-xs text-muted-foreground">No eligible crews found.</p>}
        {mode === "individuals" && !people.length && <p className="text-xs text-muted-foreground">No eligible employees found.</p>}
      </div>
    </div>
  );
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
  });
  const [task, setTask] = useState({
    title: "",
    description: "",
    dueAt: "",
    priority: "normal",
    userIds: [] as number[],
    crewIds: [] as string[],
  });
  const durationMinutes = useMemo(() => {
    const start = new Date(form.startsAt).getTime();
    const end = new Date(form.endsAt).getTime();
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
            startsAt: new Date(form.startsAt).toISOString(),
            endsAt: new Date(form.endsAt).toISOString(),
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
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
          timezone,
          open: false,
          assigneeUserIds: attendeeIds,
          qualificationCodes: [],
          calendarType: "company",
          instructions: [form.mandatory ? "Mandatory attendance." : "", form.notes].filter(Boolean).join("\n\n") || null,
        })),
      });
    },
    onSuccess: () => {
      setForm((current) => ({ ...current, title: "", meetingType: "", startsAt: "", endsAt: "", userIds: [], crewIds: [], mandatory: false, notes: "" }));
      qc.invalidateQueries({ queryKey: ["work-hub", "calendar"] });
      qc.invalidateQueries({ queryKey: ["work-hub", "meeting-types"] });
    },
  });
  const createTask = useMutation({
    mutationFn: async () => {
      if (!owner) throw new Error("Choose a company before creating a task.");
      const assignees = await expandedUsers(task.userIds, task.crewIds);
      const targets: Array<number | null> = assignees.length ? assignees : [null];
      return Promise.all(targets.map((assigneeUserId) =>
        workHubRequest("/tasks", {
          method: "POST",
          body: JSON.stringify(commandEnvelope(owner, {
            title: task.title,
            description: task.description,
            assigneeUserId,
            dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : null,
            priority: task.priority,
          })),
        }),
      ));
    },
    onSuccess: () => {
      setTask({ title: "", description: "", dueAt: "", priority: "normal", userIds: [], crewIds: [] });
      qc.invalidateQueries({ queryKey: ["work-hub", "calendar"] });
      qc.invalidateQueries({ queryKey: ["work-hub", "tasks"] });
    },
  });
  const commonClass = "grid gap-3 [&_input:not([type=checkbox])]:rounded-full [&_input:not([type=checkbox])]:border-2 [&_input:not([type=checkbox])]:border-[color:var(--brand-primary)] [&_input:not([type=checkbox])]:bg-white [&_select]:h-10 [&_select]:rounded-full [&_select]:border-2 [&_select]:border-[color:var(--brand-primary)] [&_select]:bg-white [&_select]:px-3";
  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start" data-testid="calendar-create-card-row">
      <Card id="create-shift-card" className="border-2 border-[color:var(--brand-primary)] bg-white">
        <CardHeader><CardTitle><WorkHubCardTitle icon={CalendarDays}>Create Shift/Event</WorkHubCardTitle></CardTitle></CardHeader>
        <CardContent>
          <form className={commonClass} onSubmit={(event) => { event.preventDefault(); createItem.mutate(); }}>
            <Field label="Work type">
              <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
                <option value="shift">Shift</option>
                <option value="event">Event or meeting</option>
              </select>
            </Field>
            <Field label="Meeting Type">
              <Input list="calendar-meeting-types" value={form.meetingType} onChange={(event) => setForm({ ...form, meetingType: event.target.value })} placeholder="Type or create a meeting type" />
              <datalist id="calendar-meeting-types">{meetingTypes.data?.map((type) => <option key={type.id} value={type.title} />)}</datalist>
            </Field>
            <Field label="Title"><Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required /></Field>
            <Field label="Starts"><Input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} required /></Field>
            <Field label="Ends"><Input type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} required /></Field>
            <Picker people={people.data ?? []} crews={crews.data ?? []} userIds={form.userIds} crewIds={form.crewIds} onUsers={(userIds) => setForm({ ...form, userIds })} onCrews={(crewIds) => setForm({ ...form, crewIds })} />
            <Field label="Calendar"><select value="company" disabled><option value="company">Internal company</option></select></Field>
            <Field label="Notes"><Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={form.mandatory} onChange={(event) => setForm({ ...form, mandatory: event.target.checked })} />Mandatory</label>
            {createItem.error && <p role="alert" className="text-sm text-red-700">{createItem.error instanceof Error ? createItem.error.message : "Unable to create Calendar work."}</p>}
            <BrandPillButton type="submit" tone="brand" disabled={!owner || createItem.isPending}>{createItem.isPending ? "Creating…" : "Create Shift/Event"}</BrandPillButton>
          </form>
        </CardContent>
      </Card>
      <Card className="border-2 border-[color:var(--brand-primary)] bg-white">
        <CardHeader><CardTitle><WorkHubCardTitle icon={CheckSquare2}>Create Task</WorkHubCardTitle></CardTitle></CardHeader>
        <CardContent>
          <form className={commonClass} onSubmit={(event) => { event.preventDefault(); createTask.mutate(); }}>
            <Field label="Title"><Input value={task.title} onChange={(event) => setTask({ ...task, title: event.target.value })} required /></Field>
            <Field label="Description"><Textarea value={task.description} onChange={(event) => setTask({ ...task, description: event.target.value })} /></Field>
            <Field label="Due"><Input type="datetime-local" value={task.dueAt} onChange={(event) => setTask({ ...task, dueAt: event.target.value })} /></Field>
            <Field label="Priority"><select value={task.priority} onChange={(event) => setTask({ ...task, priority: event.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></Field>
            <Picker people={people.data ?? []} crews={crews.data ?? []} userIds={task.userIds} crewIds={task.crewIds} onUsers={(userIds) => setTask({ ...task, userIds })} onCrews={(crewIds) => setTask({ ...task, crewIds })} />
            {createTask.error && <p role="alert" className="text-sm text-red-700">{createTask.error instanceof Error ? createTask.error.message : "Unable to create task."}</p>}
            <BrandPillButton type="submit" tone="brand" disabled={!owner || createTask.isPending}>{createTask.isPending ? "Creating…" : "Create Task"}</BrandPillButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
