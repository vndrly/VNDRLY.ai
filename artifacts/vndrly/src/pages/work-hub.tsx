import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  CalendarDays,
  CheckSquare2,
  FileText,
  Link2,
  MessageSquare,
  Search,
  Video,
} from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import BrandPillButton from "@/components/brand-pill-button";
import MeetingAudioRoom from "@/components/meeting-audio-room";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/use-auth";
import {
  canManageWorkHubChannels,
  commandEnvelope,
  createWorkHubOperationId,
  isWorkHubAdmin,
  isWorkHubScheduler,
  ownerForUser,
  workHubModulePath,
  workHubRequest,
} from "@/lib/work-hub-client";

const MODULES = {
  channels: [
    "Channels",
    "Contextual conversations and durable notes.",
    MessageSquare,
  ],
  calendar: [
    "Calendar",
    "Shifts, tasks, and meetings in one operational timeline.",
    CalendarDays,
  ],
  files: [
    "Files & Notes",
    "Tenant-owned files and versioned working notes.",
    FileText,
  ],
  tasks: [
    "Tasks & Forms",
    "Assignments, checklists, forms, announcements, acknowledgements, and approvals.",
    CheckSquare2,
  ],
  meetings: [
    "Meetings",
    "Scheduling, attendance, consent, chat, and catch-up records.",
    Video,
  ],
  search: ["Search", "Permission-filtered discovery across Work Hub.", Search],
  settings: [
    "Settings & Connections",
    "Optional, one-way Microsoft 365 migration controls.",
    Link2,
  ],
} as const;
type ModuleKey = keyof typeof MODULES;
type Row = Record<string, any>;
const parseIds = (value: string) =>
  value
    .split(",")
    .map(Number)
    .filter((v) => Number.isInteger(v) && v > 0);
const displayDate = (value: unknown) =>
  value ? new Date(String(value)).toLocaleString() : "No date";

function Notice({ error }: { error: unknown }) {
  return error ? (
    <p
      role="alert"
      className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900"
    >
      {error instanceof Error ? error.message : "Request failed"}
    </p>
  ) : null;
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Shell({
  module,
  children,
}: {
  module: ModuleKey;
  children: ReactNode;
}) {
  const [title, description, Icon] = MODULES[module];
  return (
    <section
      className="mx-auto max-w-7xl p-4 md:p-8"
      data-testid={`work-hub-${module}`}
    >
      <div className="mb-6 flex items-center gap-3">
        <Icon className="h-7 w-7 text-[var(--brand-primary)]" />
        <div>
          <a
            href="/work-hub"
            className="text-xs font-semibold uppercase tracking-[.2em] text-muted-foreground"
          >
            Work Hub
          </a>
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
function useOwner() {
  const { user } = useAuth();
  return ownerForUser(user);
}
function useCommand(path: string, key: unknown[]) {
  const owner = useOwner();
  const qc = useQueryClient();
  return {
    owner,
    command: useMutation({
      mutationFn: ({ payload, expectedVersion, method = "POST" }: Row) =>
        workHubRequest(path, {
          method,
          body: JSON.stringify(
            commandEnvelope(
              owner!,
              payload,
              createWorkHubOperationId(),
              expectedVersion,
            ),
          ),
        }),
      onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    }),
  };
}

function Channels() {
  const { user } = useAuth();
  const owner = ownerForUser(user);
  const canManageChannels = canManageWorkHubChannels(user);
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string>();
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"organization" | "private" | "group">("organization");
  const [body, setBody] = useState("");
  const [note, setNote] = useState({ title: "", body: "" });
  const [inviteEmail, setInviteEmail] = useState("");
  const [guidance, setGuidance] = useState<string>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const channels = useQuery<Row[]>({
    queryKey: ["work-hub", "channels"],
    queryFn: () => workHubRequest("/channels"),
  });
  const active = selected ?? channels.data?.[0]?.id;
  const messages = useQuery<Row[]>({
    queryKey: ["work-hub", "messages", active],
    queryFn: () => workHubRequest(`/channels/${active}/messages`),
    enabled: !!active,
  });
  const notes = useQuery<Row[]>({
    queryKey: ["work-hub", "notes", active],
    queryFn: () => workHubRequest(`/channels/${active}/notes`),
    enabled: !!active,
  });
  const members = useQuery<Row[]>({
    queryKey: ["work-hub", "channel-members", active],
    queryFn: () => workHubRequest(`/channels/${active}/members`),
    enabled: !!active,
  });
  const create = useMutation({
    mutationFn: () =>
      workHubRequest("/channels", {
        method: "POST",
        body: JSON.stringify(commandEnvelope(owner!, { name, visibility })),
      }),
    onSuccess: (result: Row) => {
      setName("");
      setGuidance(undefined);
      if (result?.resource?.id) setSelected(result.resource.id);
      qc.invalidateQueries({ queryKey: ["work-hub", "channels"] });
    },
  });
  const invite = useMutation({
    mutationFn: () => workHubRequest(`/channels/${active}/members`, {
      method: "POST",
      body: JSON.stringify({ email: inviteEmail }),
    }),
    onSuccess: () => {
      setInviteEmail("");
      setGuidance("Participant added. The channel will appear in their Work Hub.");
      qc.invalidateQueries({ queryKey: ["work-hub", "channel-members", active] });
    },
  });
  const send = useMutation({
    mutationFn: () =>
      workHubRequest(`/channels/${active}/messages`, {
        method: "POST",
        body: JSON.stringify(
          commandEnvelope(owner!, { body, mentionUserIds: [] }),
        ),
      }),
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: ["work-hub", "messages", active] });
    },
  });
  const saveNote = useMutation({
    mutationFn: () =>
      workHubRequest(`/channels/${active}/notes`, {
        method: "POST",
        body: JSON.stringify(commandEnvelope(owner!, note)),
      }),
    onSuccess: () => {
      setNote({ title: "", body: "" });
      qc.invalidateQueries({ queryKey: ["work-hub", "notes", active] });
    },
  });
  const remove = useMutation({
    mutationFn: () =>
      workHubRequest(`/channels/${active}`, {
        method: "DELETE",
        body: JSON.stringify(commandEnvelope(owner!, {})),
      }),
    onSuccess: () => {
      setDeleteOpen(false);
      setSelected(undefined);
      setGuidance("Channel deleted.");
      qc.invalidateQueries({ queryKey: ["work-hub", "channels"] });
    },
  });
  return (
    <Shell module="channels">
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Channels</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!canManageChannels) {
                  setGuidance("Only an organization administrator can create a channel.");
                  return;
                }
                if (!owner) {
                  setGuidance("Choose an organization before creating a channel.");
                  return;
                }
                if (!name.trim()) {
                  setGuidance("Enter a channel name first.");
                  return;
                }
                create.mutate();
              }}
            >
              <div className="flex gap-2">
                <Input
                  aria-label="Channel name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="New channel"
                />
                <BrandPillButton type="submit" tone="brand" disabled={create.isPending} className="min-w-20">Add</BrandPillButton>
              </div>
              <select aria-label="Channel access" className="h-9 rounded-md border bg-background px-3 text-sm" value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
                <option value="organization">Everyone in this organization</option>
                <option value="private">Private channel</option>
                <option value="group">Invited group</option>
              </select>
            </form>
            <Notice error={channels.error ?? create.error} />
            {guidance && (
              <p role="status" className="text-xs text-muted-foreground">
                {guidance}
              </p>
            )}
            {channels.data?.map((c) => (
              <BrandPillButton
                key={c.id}
                tone="brand"
                className="w-full justify-start"
                onClick={() => setSelected(c.id)}
              >
                # {c.name}
              </BrandPillButton>
            ))}
            {!channels.data?.length && <Empty>No channels yet.</Empty>}
            {active && canManageChannels && (
              <form className="mt-3 grid gap-2 border-t pt-3" onSubmit={(e) => {
                e.preventDefault();
                if (!inviteEmail.trim()) { setGuidance("Enter the participant's VNDRLY email first."); return; }
                invite.mutate();
              }}>
                <p className="text-xs font-semibold">Invite participants</p>
                <Input type="email" aria-label="Participant email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="name@company.com" />
                <BrandPillButton type="submit" tone="brand" disabled={invite.isPending}>Invite</BrandPillButton>
                <Notice error={invite.error} />
                {members.data?.map((member) => <p key={member.id} className="truncate text-xs text-muted-foreground">{member.displayName} · {member.email ?? "VNDRLY user"}</p>)}
              </form>
            )}
          </CardContent>
        </Card>
        {active && <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Conversation</CardTitle>
              {canManageChannels && (
                <BrandPillButton tone="red" aria-label="Delete channel" onClick={() => setDeleteOpen(true)}>
                  Delete channel
                </BrandPillButton>
              )}
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Notice error={messages.error ?? send.error} />
            <div className="max-h-[52vh] space-y-2 overflow-auto">
              {messages.data?.map((m) => (
                <article key={m.id} className="rounded-lg border p-3">
                  <p className="whitespace-pre-wrap text-sm">{m.body}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    User {m.authorUserId} · {displayDate(m.createdAt)} · v
                    {m.version}
                  </p>
                </article>
              ))}
            </div>
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!active) {
                  setGuidance("Create or select a channel before sending a message.");
                  return;
                }
                if (!body.trim()) {
                  setGuidance("Write a message first.");
                  return;
                }
                send.mutate();
              }}
            >
              <Textarea
                aria-label="Message"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write a message…"
              />
              <BrandPillButton type="submit" tone="brand" disabled={send.isPending}>Send message</BrandPillButton>
            </form>
          </CardContent>
        </Card>}
        {active && <Card>
          <CardHeader>
            <CardTitle>Channel notes</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {notes.data?.map((n) => (
              <article key={n.id} className="rounded-lg border p-3">
                <strong>{n.title}</strong>
                <p className="text-sm text-muted-foreground">{n.body}</p>
              </article>
            ))}
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!active) {
                  setGuidance("Create or select a channel before saving a note.");
                  return;
                }
                if (!note.title.trim() || !note.body.trim()) {
                  setGuidance("Add both a note title and note text first.");
                  return;
                }
                saveNote.mutate();
              }}
            >
              <Input
                aria-label="Note title"
                value={note.title}
                onChange={(e) => setNote({ ...note, title: e.target.value })}
                placeholder="Note title"
              />
              <Textarea
                aria-label="Note body"
                value={note.body}
                onChange={(e) => setNote({ ...note, body: e.target.value })}
                placeholder="Durable context"
              />
              <BrandPillButton type="submit" tone="brand" disabled={saveNote.isPending}>
                Save note
              </BrandPillButton>
            </form>
          </CardContent>
        </Card>}
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this channel?</AlertDialogTitle>
              <AlertDialogDescription>
                The channel will be removed from participant views. Its audit history is retained.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel asChild><BrandPillButton tone="image">Cancel</BrandPillButton></AlertDialogCancel>
              <AlertDialogAction asChild><BrandPillButton tone="red" onClick={() => remove.mutate()} disabled={remove.isPending}>
                {remove.isPending ? "Deleting…" : "Delete channel"}
              </BrandPillButton></AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Shell>
  );
}

function CalendarModule() {
  const { user } = useAuth();
  const canManage = isWorkHubScheduler(user);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(() => new Date().toISOString().slice(0, 10));
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const calendar = useQuery<Row>({
    queryKey: ["work-hub", "calendar", start.toISOString(), end.toISOString()],
    queryFn: () =>
      workHubRequest(
        `/calendar?start=${start.toISOString()}&end=${end.toISOString()}`,
      ),
  });
  const channelSummary = useQuery<Row[]>({
    queryKey: ["work-hub", "channels"],
    queryFn: () => workHubRequest("/channels"),
  });
  const { owner, command } = useCommand("/shifts", ["work-hub", "calendar"]);
  const [form, setForm] = useState({
    title: "",
    startsAt: "",
    endsAt: "",
    assignees: "",
    calendarType: "company",
    projectName: "",
    milestoneStatus: "upcoming",
    percentComplete: "0",
    sharedWith: "",
  });
  const items = useMemo(
    () =>
      [
        ...(calendar.data?.shifts ?? []).map((x: Row) => ({
          ...x.item,
          kind: "Shift",
        })),
        ...(calendar.data?.tasks ?? []).map((x: Row) => ({
          ...x.item,
          startsAt: x.item.dueAt,
          kind: "Task",
        })),
        ...(calendar.data?.meetings ?? []).map((x: Row) => ({
          ...x.occurrence,
          title: x.meeting.title,
          kind: "Meeting",
        })),
      ].sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt))),
    [calendar.data],
  );
  const firstWeekday = start.getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const calendarDays = Array.from({ length: firstWeekday + daysInMonth }, (_, index) => index < firstWeekday ? null : index - firstWeekday + 1);
  const dateKey = (value: unknown) => value ? new Date(String(value)).toLocaleDateString("en-CA") : "";
  const selectedItems = items.filter((item) => dateKey(item.startsAt) === selectedDay);
  const nextOfKind = (kind: string) => items.find((item) => item.kind === kind && new Date(item.startsAt).getTime() >= Date.now());
  const nextShift = nextOfKind("Shift");
  const nextMeeting = nextOfKind("Meeting");
  const nextTask = nextOfKind("Task");
  const unreadMessages = (channelSummary.data ?? []).reduce((total, channel) => total + Number(channel.unreadCount ?? 0), 0);
  return (
    <Shell module="calendar">
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["My next shift", nextShift?.title ?? "Nothing scheduled", nextShift?.startsAt ? displayDate(nextShift.startsAt) : ""],
            ["Next meeting", nextMeeting?.title ?? "Nothing scheduled", nextMeeting?.startsAt ? displayDate(nextMeeting.startsAt) : ""],
            ["Tasks due soon", nextTask?.title ?? "No task due", nextTask?.startsAt ? displayDate(nextTask.startsAt) : ""],
          ].map(([title, value, detail]) => <Card key={title}><CardContent className="pt-5"><p className="text-xs font-semibold uppercase text-muted-foreground">{title}</p><p className="mt-1 font-semibold">{value}</p>{detail && <p className="text-xs text-muted-foreground">{detail}</p>}</CardContent></Card>)}
          <Card><CardContent className="pt-5"><p className="text-xs font-semibold uppercase text-muted-foreground">Unread channel messages</p><p className="mt-1 text-2xl font-bold">{unreadMessages}</p><a href="/work-hub/channels" className="text-xs font-semibold text-[var(--brand-primary)] underline">Open channels</a></CardContent></Card>
        </div>
        <div
          className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)] lg:items-start"
          data-testid="work-hub-calendar-layout"
        >
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</CardTitle>
              <div className="flex gap-2">
                <BrandPillButton tone="brand" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>Previous</BrandPillButton>
                <BrandPillButton tone="brand" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>Next</BrandPillButton>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-2">
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-muted-foreground">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="py-2">{day}</div>)}
              {calendarDays.map((day, index) => {
                if (!day) return <div key={`blank-${index}`} />;
                const key = new Date(month.getFullYear(), month.getMonth(), day).toLocaleDateString("en-CA");
                const count = items.filter((item) => dateKey(item.startsAt) === key).length;
                return <button key={key} type="button" onClick={() => setSelectedDay(key)} className={`min-h-20 rounded-lg border p-2 text-left transition-colors hover:border-[var(--brand-primary)] ${selectedDay === key ? "border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)]" : "bg-card"}`}>
                  <span className="font-semibold">{day}</span>
                  {count > 0 && <span className="mt-2 block text-xs text-[var(--brand-primary)]">{count} {count === 1 ? "event" : "events"}</span>}
                </button>;
              })}
            </div>
            <h2 className="mt-4 font-semibold">{new Date(`${selectedDay}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</h2>
            {selectedItems.map((i) => (
              <article
                key={`${i.kind}-${i.id}`}
                className="flex justify-between rounded-lg border p-4"
              >
                <div>
                  <span className="text-xs uppercase text-muted-foreground">
                    {i.kind}
                  </span>
                  <h2 className="font-semibold">{i.title}</h2>
                </div>
                <time className="text-sm">{displayDate(i.startsAt)}</time>
              </article>
            ))}
            {!selectedItems.length && <Empty>No scheduled work for this day.</Empty>}
          </CardContent>
        </Card>
        {canManage && <Card>
          <CardHeader>
            <CardTitle>Create shift</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                command.mutate({
                  payload: {
                    title: form.title,
                    startsAt: new Date(form.startsAt).toISOString(),
                    endsAt: new Date(form.endsAt).toISOString(),
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    open: false,
                    assigneeUserIds: parseIds(form.assignees),
                    qualificationCodes: [],
                    calendarType: form.calendarType,
                    projectName: form.projectName || null,
                    milestoneStatus: form.milestoneStatus,
                    percentComplete: Number(form.percentComplete) || 0,
                    sharedWithUserIds: parseIds(form.sharedWith),
                  },
                });
              }}
            >
              <Field label="Title">
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                />
              </Field>
              <Field label="Starts">
                <Input
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(e) =>
                    setForm({ ...form, startsAt: e.target.value })
                  }
                  required
                />
              </Field>
              <Field label="Ends">
                <Input
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                  required
                />
              </Field>
              <Field label="Assignee user IDs">
                <Input
                  value={form.assignees}
                  onChange={(e) =>
                    setForm({ ...form, assignees: e.target.value })
                  }
                  placeholder="12,18"
                />
              </Field>
              <Field label="Calendar"><select className="h-10 rounded-md border bg-background px-3" value={form.calendarType} onChange={(e) => setForm({ ...form, calendarType: e.target.value })}><option value="company">Internal company</option><option value="project">Shared project</option></select></Field>
              {form.calendarType === "project" && <>
                <Field label="Project name"><Input value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })} required /></Field>
                <Field label="Milestone status"><select className="h-10 rounded-md border bg-background px-3" value={form.milestoneStatus} onChange={(e) => setForm({ ...form, milestoneStatus: e.target.value })}><option value="upcoming">Upcoming</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="blocked">Blocked</option><option value="overdue">Overdue</option></select></Field>
                <Field label="Percent complete"><Input type="number" min="0" max="100" value={form.percentComplete} onChange={(e) => setForm({ ...form, percentComplete: e.target.value })} /></Field>
                <Field label="Share with user IDs"><Input value={form.sharedWith} onChange={(e) => setForm({ ...form, sharedWith: e.target.value })} placeholder="Invited partner or vendor users" /></Field>
              </>}
              <Notice error={command.error} />
              <BrandPillButton type="submit" tone="brand" disabled={!owner || command.isPending}>Publish shift</BrandPillButton>
            </form>
          </CardContent>
        </Card>}
        </div>
        <Card>
          <CardHeader><CardTitle>Project timeline</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {items.filter((item) => item.calendarType === "project").map((item) => <article key={`timeline-${item.id}`} className="rounded-lg border p-4"><div className="flex justify-between gap-3"><div><span className="text-xs uppercase text-muted-foreground">{item.projectName} · {String(item.milestoneStatus).replace("_", " ")}</span><h3 className="font-semibold">{item.title}</h3><p className="text-xs">{displayDate(item.startsAt)} – {displayDate(item.endsAt)}</p></div><strong>{item.percentComplete ?? 0}%</strong></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-[var(--brand-primary)]" style={{ width: `${item.percentComplete ?? 0}%` }} /></div></article>)}
            {!items.some((item) => item.calendarType === "project") && <Empty>No shared project milestones in this month.</Empty>}
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}

function Governance({
  owner,
  data,
}: {
  owner: ReturnType<typeof ownerForUser>;
  data?: Row;
}) {
  const qc = useQueryClient();
  const [announcement, setAnnouncement] = useState({
    title: "",
    body: "",
    recipients: "",
    acknowledgementRequired: true,
  });
  const [approval, setApproval] = useState({
    subjectType: "task",
    subjectId: "",
    approvers: "",
  });
  const publish = useMutation({
    mutationFn: () =>
      workHubRequest("/announcements", {
        method: "POST",
        body: JSON.stringify(
          commandEnvelope(owner!, {
            title: announcement.title,
            body: announcement.body,
            recipientUserIds: parseIds(announcement.recipients),
            urgency: "normal",
            acknowledgementRequired: announcement.acknowledgementRequired,
          }),
        ),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-hub", "admin"] }),
  });
  const request = useMutation({
    mutationFn: () =>
      workHubRequest("/admin/approvals", {
        method: "POST",
        body: JSON.stringify(
          commandEnvelope(owner!, {
            subjectType: approval.subjectType,
            subjectId: approval.subjectId,
            subjectVersion: 1,
            approverUserIds: parseIds(approval.approvers),
            mode: "ordered",
          }),
        ),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-hub", "admin"] }),
  });
  const acknowledge = useMutation({
    mutationFn: (id: string) =>
      workHubRequest(`/announcements/${id}/acknowledge`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-hub", "admin"] }),
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: Row) =>
      workHubRequest(`/admin/approvals/${id}/decide`, {
        method: "POST",
        body: JSON.stringify(commandEnvelope(owner!, { decision })),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-hub", "admin"] }),
  });
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Announcements and acknowledgements</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              publish.mutate();
            }}
          >
            <Input
              aria-label="Announcement title"
              value={announcement.title}
              onChange={(e) =>
                setAnnouncement({ ...announcement, title: e.target.value })
              }
              placeholder="Announcement title"
              required
            />
            <Textarea
              aria-label="Announcement body"
              value={announcement.body}
              onChange={(e) =>
                setAnnouncement({ ...announcement, body: e.target.value })
              }
              placeholder="Operational announcement"
              required
            />
            <Input
              aria-label="Announcement recipients"
              value={announcement.recipients}
              onChange={(e) =>
                setAnnouncement({ ...announcement, recipients: e.target.value })
              }
              placeholder="Recipient user IDs: 12,18"
              required
            />
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={announcement.acknowledgementRequired}
                onChange={(e) =>
                  setAnnouncement({
                    ...announcement,
                    acknowledgementRequired: e.target.checked,
                  })
                }
              />
              Require acknowledgement
            </label>
            <BrandPillButton type="submit" tone="brand" disabled={!owner}>Publish and assign</BrandPillButton>
          </form>
          <Notice error={publish.error ?? acknowledge.error} />
          {data?.announcements?.map((row: Row) => (
            <article key={row.id} className="rounded-lg border p-3">
              <strong>{row.title}</strong>
              <p className="text-sm text-muted-foreground">{row.body}</p>
              {row.acknowledgementRequired && (
                <BrandPillButton
                  className="mt-2"
                  tone="brand"
                  onClick={() => acknowledge.mutate(row.id)}
                >
                  Acknowledge
                </BrandPillButton>
              )}
            </article>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Approval requests</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              request.mutate();
            }}
          >
            <Input
              aria-label="Approval subject type"
              value={approval.subjectType}
              onChange={(e) =>
                setApproval({ ...approval, subjectType: e.target.value })
              }
              placeholder="Subject type"
            />
            <Input
              aria-label="Approval subject ID"
              value={approval.subjectId}
              onChange={(e) =>
                setApproval({ ...approval, subjectId: e.target.value })
              }
              placeholder="Subject ID"
              required
            />
            <Input
              aria-label="Approver user IDs"
              value={approval.approvers}
              onChange={(e) =>
                setApproval({ ...approval, approvers: e.target.value })
              }
              placeholder="Approver user IDs: 12,18"
              required
            />
            <BrandPillButton type="submit" tone="brand" disabled={!owner}>Request ordered approval</BrandPillButton>
          </form>
          <Notice error={request.error ?? decide.error} />
          {data?.approvals?.map((row: Row) => (
            <article key={row.id} className="rounded-lg border p-3">
              <span className="text-xs uppercase text-muted-foreground">
                {row.status} · {row.mode}
              </span>
              <strong className="block">
                {row.subjectType} · {row.subjectId}
              </strong>
              {row.status === "pending" && (
                <div className="mt-2 flex gap-2">
                  <BrandPillButton
                    tone="green"
                    onClick={() =>
                      decide.mutate({ id: row.id, decision: "approved" })
                    }
                  >
                    Approve
                  </BrandPillButton>
                  <BrandPillButton
                    tone="red"
                    onClick={() =>
                      decide.mutate({ id: row.id, decision: "rejected" })
                    }
                  >
                    Reject
                  </BrandPillButton>
                </div>
              )}
            </article>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function TasksModule() {
  const { user } = useAuth();
  const canManage = isWorkHubScheduler(user);
  const owner = useOwner();
  const qc = useQueryClient();
  const tasks = useQuery<Row[]>({
    queryKey: ["work-hub", "tasks"],
    queryFn: () => workHubRequest("/tasks"),
  });
  const admin = useQuery<Row>({
    queryKey: ["work-hub", "admin"],
    queryFn: () => workHubRequest("/admin"),
    retry: false,
  });
  const required = useQuery<Row>({
    queryKey: ["work-hub", "required-actions"],
    queryFn: () => workHubRequest("/required-actions"),
  });
  const [task, setTask] = useState({
    title: "",
    description: "",
    assignee: "",
    dueAt: "",
  });
  const [template, setTemplate] = useState({
    kind: "checklist",
    name: "",
    fields: "Inspect equipment\nConfirm PPE\nRecord exceptions",
  });
  const [formValues, setFormValues] = useState<
    Record<string, Record<string, string>>
  >({});
  const respond = useMutation({
    mutationFn: ({ kind, instance, values, decision }: Row) =>
      workHubRequest(
        kind === "approval"
          ? `/admin/approvals/${instance.id}/decide`
          : `/${kind}s/${instance.id}/${kind === "form" ? "submit" : "respond"}`,
        {
          method: "POST",
          body: JSON.stringify(
            kind === "approval"
              ? commandEnvelope(owner!, { decision })
              : commandEnvelope(
                  owner!,
                  kind === "form"
                    ? { values }
                    : { responses: values, complete: true },
                ),
          ),
        },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["work-hub", "required-actions"] }),
  });
  const create = useMutation({
    mutationFn: () =>
      workHubRequest("/tasks", {
        method: "POST",
        body: JSON.stringify(
          commandEnvelope(owner!, {
            title: task.title,
            description: task.description,
            assigneeUserId: Number(task.assignee) || null,
            dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : null,
            priority: "normal",
          }),
        ),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-hub", "tasks"] }),
  });
  const update = useMutation({
    mutationFn: ({ row, status }: Row) =>
      workHubRequest(`/tasks/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify(
          commandEnvelope(owner!, { status }, crypto.randomUUID(), row.version),
        ),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-hub", "tasks"] }),
  });
  const publish = useMutation({
    mutationFn: () =>
      workHubRequest(`/admin/${template.kind}s`, {
        method: "POST",
        body: JSON.stringify(
          commandEnvelope(owner!, {
            name: template.name,
            definition: template.fields
              .split("\n")
              .filter(Boolean)
              .map((label, index) => ({
                id: `field-${index + 1}`,
                label,
                type: template.kind === "form" ? "text" : "checkbox",
                required: true,
              })),
          }),
        ),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-hub", "admin"] }),
  });
  const assignTemplate = useMutation({
    mutationFn: (row: Row) =>
      workHubRequest(`/admin/${row.kind.toLowerCase()}s/${row.id}/assign`, {
        method: "POST",
        body: JSON.stringify(
          commandEnvelope(owner!, {
            assigneeUserId: Number(task.assignee),
            dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : null,
          }),
        ),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-hub", "admin"] }),
  });
  return (
    <Shell module="tasks">
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>Assignments and review</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {tasks.data?.map((row) => (
              <article key={row.id} className="rounded-lg border p-4">
                <div className="flex justify-between gap-3">
                  <div>
                    <span className="text-xs uppercase text-muted-foreground">
                      {row.priority} · {row.status}
                    </span>
                    <h2 className="font-semibold">{row.title}</h2>
                    <p className="text-sm text-muted-foreground">
                      {row.description}
                    </p>
                    <p className="text-xs">
                      Assignee {row.assigneeUserId ?? "unassigned"} · Due{" "}
                      {displayDate(row.dueAt)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {row.status === "open" && (
                      <BrandPillButton
                        tone="brand"
                        onClick={() =>
                          update.mutate({ row, status: "in_progress" })
                        }
                      >
                        Start
                      </BrandPillButton>
                    )}
                    {row.status !== "completed" && (
                      <BrandPillButton
                        tone="green"
                        onClick={() =>
                          update.mutate({ row, status: "completed" })
                        }
                      >
                        Complete
                      </BrandPillButton>
                    )}
                  </div>
                </div>
              </article>
            ))}
            {!tasks.data?.length && <Empty>No tasks yet.</Empty>}
          </CardContent>
        </Card>
        {canManage && <Card>
          <CardHeader>
            <CardTitle>Assign task</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <Field label="Title">
                <Input
                  value={task.title}
                  onChange={(e) => setTask({ ...task, title: e.target.value })}
                  required
                />
              </Field>
              <Field label="Description">
                <Textarea
                  value={task.description}
                  onChange={(e) =>
                    setTask({ ...task, description: e.target.value })
                  }
                />
              </Field>
              <Field label="Assignee user ID">
                <Input
                  value={task.assignee}
                  onChange={(e) =>
                    setTask({ ...task, assignee: e.target.value })
                  }
                />
              </Field>
              <Field label="Due">
                <Input
                  type="datetime-local"
                  value={task.dueAt}
                  onChange={(e) => setTask({ ...task, dueAt: e.target.value })}
                />
              </Field>
              <Notice error={create.error} />
              <BrandPillButton type="submit" tone="brand" disabled={!owner}>Assign</BrandPillButton>
            </form>
          </CardContent>
        </Card>}
      </div>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>My checklists, forms, and approvals</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {required.data?.checklists?.map(({ instance, template }: Row) => (
            <article key={instance.id} className="rounded-lg border p-4">
              <span className="text-xs uppercase text-muted-foreground">
                Checklist · {instance.status}
              </span>
              <h3 className="font-semibold">{template.name}</h3>
              <p className="text-xs">
                {instance.snapshot?.length ?? 0} items · Due{" "}
                {displayDate(instance.dueAt)}
              </p>
              {instance.status !== "completed" && (
                <BrandPillButton
                  className="mt-3"
                  tone="green"
                  onClick={() =>
                    respond.mutate({
                      kind: "checklist",
                      instance,
                      values: Object.fromEntries(
                        (instance.snapshot ?? []).map((field: Row) => [
                          field.id,
                          true,
                        ]),
                      ),
                    })
                  }
                >
                  Complete checklist
                </BrandPillButton>
              )}
            </article>
          ))}
          {required.data?.forms?.map(({ instance, template }: Row) => (
            <article key={instance.id} className="rounded-lg border p-4">
              <span className="text-xs uppercase text-muted-foreground">
                Form
              </span>
              <h3 className="font-semibold">{template.name}</h3>
              <div className="mt-2 grid gap-2">
                {(instance.definitionSnapshot ?? []).map((field: Row) => (
                  <Field key={field.id} label={field.label}>
                    <Input
                      value={formValues[instance.id]?.[field.id] ?? ""}
                      onChange={(e) =>
                        setFormValues({
                          ...formValues,
                          [instance.id]: {
                            ...formValues[instance.id],
                            [field.id]: e.target.value,
                          },
                        })
                      }
                      required={field.required}
                    />
                  </Field>
                ))}
              </div>
              <BrandPillButton
                className="mt-3"
                tone="brand"
                onClick={() =>
                  respond.mutate({
                    kind: "form",
                    instance,
                    values: formValues[instance.id] ?? {},
                  })
                }
              >
                Submit form
              </BrandPillButton>
            </article>
          ))}
          {required.data?.approvals?.map(({ request: row, step }: Row) => (
            <article key={step.id} className="rounded-lg border p-4">
              <span className="text-xs uppercase text-muted-foreground">
                Approval · {step.decision ?? "pending"}
              </span>
              <h3 className="font-semibold">
                {row.subjectType} · {row.subjectId}
              </h3>
              {!step.decision && (
                <div className="mt-3 flex gap-2">
                  <BrandPillButton
                    tone="green"
                    onClick={() =>
                      respond.mutate({
                        kind: "approval",
                        instance: row,
                        decision: "approved",
                      })
                    }
                  >
                    Approve
                  </BrandPillButton>
                  <BrandPillButton
                    tone="red"
                    onClick={() =>
                      respond.mutate({
                        kind: "approval",
                        instance: row,
                        decision: "rejected",
                      })
                    }
                  >
                    Reject
                  </BrandPillButton>
                </div>
              )}
            </article>
          ))}
          {!required.data?.checklists?.length &&
            !required.data?.forms?.length &&
            !required.data?.approvals?.length && (
              <Empty>No required actions.</Empty>
            )}
        </CardContent>
      </Card>
      {canManage && <Card className="mt-4">
        <CardHeader>
          <CardTitle>Reusable checklists and forms</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              publish.mutate();
            }}
          >
            <Field label="Type">
              <select
                className="h-10 rounded-md border bg-background px-3"
                value={template.kind}
                onChange={(e) =>
                  setTemplate({ ...template, kind: e.target.value })
                }
              >
                <option value="checklist">Checklist</option>
                <option value="form">Form</option>
              </select>
            </Field>
            <Field label="Name">
              <Input
                value={template.name}
                onChange={(e) =>
                  setTemplate({ ...template, name: e.target.value })
                }
                required
              />
            </Field>
            <Field label="Fields (one per line)">
              <Textarea
                rows={5}
                value={template.fields}
                onChange={(e) =>
                  setTemplate({ ...template, fields: e.target.value })
                }
              />
            </Field>
            <Notice error={publish.error} />
            <Notice error={assignTemplate.error} />
            <BrandPillButton type="submit" tone="brand" disabled={!owner}>Publish template</BrandPillButton>
          </form>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ...(admin.data?.checklists ?? []).map((x: Row) => ({
                ...x,
                kind: "Checklist",
              })),
              ...(admin.data?.forms ?? []).map((x: Row) => ({
                ...x,
                kind: "Form",
              })),
            ].map((row) => (
              <article key={row.id} className="rounded-lg border p-4">
                <span className="text-xs uppercase text-muted-foreground">
                  {row.kind} · v{row.currentVersion}
                </span>
                <h3 className="font-semibold">{row.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {row.definition?.length ?? 0} fields · published snapshot
                </p>
                <BrandPillButton
                  className="mt-3"
                  tone="brand"
                  disabled={!owner || !Number(task.assignee)}
                  onClick={() => assignTemplate.mutate(row)}
                >
                  Assign to user {task.assignee || "…"}
                </BrandPillButton>
              </article>
            ))}
          </div>
        </CardContent>
      </Card>}
      {canManage && <Governance owner={owner} data={admin.data} />}
    </Shell>
  );
}

function MeetingsModule() {
  const { user } = useAuth();
  const canManage = isWorkHubAdmin(user);
  const owner = useOwner();
  const qc = useQueryClient();
  const now = new Date();
  const end = new Date(now);
  end.setMonth(end.getMonth() + 3);
  const calendar = useQuery<Row>({
    queryKey: ["work-hub", "meetings"],
    queryFn: () =>
      workHubRequest(
        `/calendar?start=${now.toISOString()}&end=${end.toISOString()}`,
      ),
  });
  const [form, setForm] = useState({
    title: "",
    agenda: "",
    startsAt: "",
    endsAt: "",
    participants: "",
  });
  const [selected, setSelected] = useState<string>();
  const catchUp = useQuery<Row>({
    queryKey: ["work-hub", "meeting-catch-up", selected],
    queryFn: () => workHubRequest(`/meetings/${selected}/catch-up`),
    enabled: !!selected,
    refetchInterval: selected ? 5_000 : false,
  });
  const create = useMutation({
    mutationFn: () =>
      workHubRequest("/meetings", {
        method: "POST",
        body: JSON.stringify(
          commandEnvelope(owner!, {
            title: form.title,
            agenda: form.agenda,
            startsAt: new Date(form.startsAt).toISOString(),
            endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            recordingAllowed: false,
            participantUserIds: parseIds(form.participants),
          }),
        ),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["work-hub", "meetings"] }),
  });
  const startNow = useMutation({
    mutationFn: () => {
      const startsAt = new Date();
      const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
      return workHubRequest("/meetings", { method: "POST", body: JSON.stringify(commandEnvelope(owner!, {
        title: form.title || "Audio meeting", agenda: form.agenda, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, recordingAllowed: false, participantUserIds: parseIds(form.participants),
      })) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-hub", "meetings"] }),
  });
  return (
    <Shell module="meetings">
      {canManage && <div className="mb-4 flex flex-wrap gap-2">
        <BrandPillButton tone="brand" onClick={() => document.getElementById("schedule-meeting")?.scrollIntoView({ behavior: "smooth" })}>Schedule meeting</BrandPillButton>
        <BrandPillButton tone="green" disabled={!owner || startNow.isPending} onClick={() => startNow.mutate()}>Start meeting now</BrandPillButton>
      </div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>Scheduled meetings</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {calendar.data?.meetings?.map(({ meeting, occurrence }: Row) => (
              <article key={occurrence.id} className="rounded-lg border p-4">
                <h2 className="font-semibold">{meeting.title}</h2>
                <p className="text-sm text-muted-foreground">
                  {meeting.agenda}
                </p>
                <p className="text-xs">
                  {displayDate(occurrence.startsAt)} · Recording{" "}
                  {meeting.recordingAllowed ? "requires consent" : "disabled"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <BrandPillButton tone="green" onClick={() => setSelected(occurrence.id)}>Open meeting</BrandPillButton>
                  <BrandPillButton tone="brand" onClick={() => setSelected(occurrence.id)}>View notes</BrandPillButton>
                </div>
              </article>
            ))}
            {!calendar.data?.meetings?.length && (
              <Empty>No meetings scheduled.</Empty>
            )}
          </CardContent>
        </Card>
        {canManage ? <Card id="schedule-meeting">
          <CardHeader>
            <CardTitle>Schedule meeting</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <Field label="Title">
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                />
              </Field>
              <Field label="Agenda">
                <Textarea
                  value={form.agenda}
                  onChange={(e) => setForm({ ...form, agenda: e.target.value })}
                />
              </Field>
              <Field label="Starts">
                <Input
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(e) =>
                    setForm({ ...form, startsAt: e.target.value })
                  }
                  required
                />
              </Field>
              <Field label="Ends">
                <Input
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                />
              </Field>
              <Field label="Participant user IDs">
                <Input
                  value={form.participants}
                  onChange={(e) =>
                    setForm({ ...form, participants: e.target.value })
                  }
                />
              </Field>
              <Notice error={create.error} />
              <BrandPillButton type="submit" tone="brand" disabled={!owner}>Schedule and invite</BrandPillButton>
            </form>
          </CardContent>
        </Card> : <Card><CardHeader><CardTitle>Participant access</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">Administrators schedule and start meetings. Your invited meetings appear here with a Join action when available.</p></CardContent></Card>}
      </div>
      {selected && <Card className="mt-4">
        <CardHeader><CardTitle>Meeting workspace</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <MeetingAudioRoom occurrenceId={selected} />
          <section><h3 className="font-semibold">Transcript and catch-up notes</h3>
            {(catchUp.data?.transcript ?? []).map((line: Row) => <p key={line.id} className="mt-2 rounded-lg border p-3 text-sm">{line.text}</p>)}
            {!catchUp.data?.transcript?.length && <Empty>Transcript, decisions, and action items will appear here for invited participants.</Empty>}
          </section>
        </CardContent>
      </Card>}
    </Shell>
  );
}
function FilesModule() {
  const owner = useOwner();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const files = useQuery<Row[]>({
    queryKey: ["work-hub", "files"],
    queryFn: () => workHubRequest("/files"),
  });
  const channels = useQuery<Row[]>({ queryKey: ["work-hub", "channels"], queryFn: () => workHubRequest("/channels") });
  const [category, setCategory] = useState("All");
  const [channelId, setChannelId] = useState("");
  const [accessLevel, setAccessLevel] = useState("internal");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const upload = useMutation({ mutationFn: async () => {
    if (!owner || !uploadFile || !channelId) throw new Error("Choose a channel and file first.");
    const checksum = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await uploadFile.arrayBuffer()))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const reserved = await workHubRequest<Row>("/files/reserve", { method: "POST", body: JSON.stringify(commandEnvelope(owner, { channelId, fileName: uploadFile.name, contentType: uploadFile.type || "application/octet-stream", byteSize: uploadFile.size, checksumSha256: checksum, category, accessLevel, tags: [] })) });
    const descriptor = reserved.resource ?? reserved;
    const response = await fetch(descriptor.uploadURL, { method: "PUT", body: uploadFile, headers: { "Content-Type": uploadFile.type || "application/octet-stream" } });
    if (!response.ok) throw new Error("The file upload did not complete.");
    return workHubRequest(`/files/${descriptor.file.id}/finalize`, { method: "POST", body: JSON.stringify({ objectURL: descriptor.uploadURL }) });
  }, onSuccess: () => { setUploadFile(null); void qc.invalidateQueries({ queryKey: ["work-hub", "files"] }); } });
  const categories = ["Meeting Notes", "Safety & Compliance", "Site & Project Documents", "Procedures & Checklists", "Photos & Field Reports", "Contracts & Approvals", "Training Materials", "General Notes"];
  const visibleFiles = (files.data ?? []).filter((file) => category === "All" || file.mediaMetadata?.category === category);
  return (
    <Shell module="files">
      <Card className="mb-4"><CardHeader><CardTitle>Add an authorized file</CardTitle></CardHeader><CardContent><form className="grid gap-3 md:grid-cols-4" onSubmit={(event) => { event.preventDefault(); upload.mutate(); }}>
        <select aria-label="File channel" className="h-10 rounded-md border bg-background px-3" value={channelId} onChange={(e) => setChannelId(e.target.value)}><option value="">Choose channel</option>{channels.data?.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select>
        <select aria-label="File category" className="h-10 rounded-md border bg-background px-3" value={category === "All" ? "General Notes" : category} onChange={(e) => setCategory(e.target.value)}>{categories.map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="File access" className="h-10 rounded-md border bg-background px-3" value={accessLevel} onChange={(e) => setAccessLevel(e.target.value)}><option value="internal">Internal</option><option value="shared">Shared with channel</option></select>
        <div className="flex min-w-0 items-center gap-2">
          <input
            ref={fileInputRef}
            data-testid="work-hub-file-input"
            aria-label="Choose file"
            className="sr-only"
            type="file"
            onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
          />
          <BrandPillButton type="button" tone="brand" onClick={() => fileInputRef.current?.click()}>
            Choose file
          </BrandPillButton>
          {uploadFile && <span className="truncate text-xs text-muted-foreground">{uploadFile.name}</span>}
        </div>
        <Notice error={upload.error} /><BrandPillButton type="submit" tone="brand" disabled={!channelId || !uploadFile || upload.isPending}>Upload file</BrandPillButton>
      </form></CardContent></Card>
      <Card>
        <CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>Files and notes library</CardTitle><select aria-label="Filter file category" className="h-10 rounded-md border bg-background px-3" value={category} onChange={(e) => setCategory(e.target.value)}><option>All</option>{categories.map((value) => <option key={value}>{value}</option>)}</select></div></CardHeader>
        <CardContent className="grid gap-2">
          <Notice error={files.error} />
          {visibleFiles.map((f) => (
            <article
              key={f.id}
              className="flex justify-between rounded-lg border p-4"
            >
              <div>
                <h2 className="font-semibold">{f.fileName}</h2>
                <p className="text-xs text-muted-foreground">
                  {f.contentType} · {Math.ceil(f.byteSize / 1024)} KB ·{" "}
                  {displayDate(f.finalizedAt)}
                </p>
                <p className="text-xs">{f.mediaMetadata?.category ?? "General Notes"} · {f.mediaMetadata?.accessLevel ?? "internal"}</p>
              </div>
              <span className="text-xs uppercase">{f.state}</span>
            </article>
          ))}
          {!visibleFiles.length && (
            <Empty>
              No finalized files. Upload files from an authorized channel so
              access follows channel membership.
            </Empty>
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}
function SearchModule() {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [type, setType] = useState("");
  const results = useQuery<Row[]>({
    queryKey: ["work-hub", "search", term, start, end, type],
    queryFn: () => {
      const params = new URLSearchParams({ q: term });
      if (start) params.set("start", new Date(`${start}T00:00:00`).toISOString());
      if (end) params.set("end", new Date(`${end}T23:59:59.999`).toISOString());
      if (type) params.set("type", type);
      return workHubRequest(`/search?${params.toString()}`);
    },
    enabled: term.length >= 2,
  });
  return (
    <Shell module="search">
      <Card>
        <CardHeader>
          <CardTitle>Search authorized records</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <form
            className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              setTerm(q.trim());
            }}
          >
            <Input
              aria-label="Search Work Hub"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Messages, files, tasks, forms, meetings"
            />
            <Input aria-label="Search start date" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            <Input aria-label="Search end date" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            <select aria-label="Search record type" className="h-10 rounded-md border bg-background px-3" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All records</option>
              <option value="message">Messages</option><option value="file">Files</option><option value="task">Tasks</option><option value="form">Forms</option><option value="meeting">Meetings</option><option value="announcement">Announcements</option>
            </select>
            <BrandPillButton type="submit" tone="brand">Search</BrandPillButton>
          </form>
          {results.data?.map((r) => (
            <a
              key={r.id}
              href={workHubModulePath(r.subjectType, r.subjectId)}
              className="rounded-lg border p-4 hover:bg-muted"
            >
              <span className="text-xs uppercase text-muted-foreground">
                {r.subjectType} · {r.contextKind}
              </span>
              <h2 className="font-semibold">{r.title || "Untitled record"}</h2>
              <p className="text-xs">Updated {displayDate(r.updatedAt)}</p>
            </a>
          ))}
          {term && !results.data?.length && (
            <Empty>No authorized results found.</Empty>
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}
function SettingsModule() {
  const { user } = useAuth();
  const canManage = isWorkHubAdmin(user);
  const connector = useQuery<Row>({
    queryKey: ["work-hub", "microsoft"],
    queryFn: () => workHubRequest("/connectors/microsoft-365"),
  });
  const audit = useQuery<Row[]>({
    queryKey: ["work-hub", "audit"],
    queryFn: () => workHubRequest("/audit"),
    enabled: canManage,
  });
  return (
    <Shell module="settings">
      <Card>
        <CardHeader>
          <CardTitle>Microsoft 365 import</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="rounded-lg border border-amber-400/40 bg-amber-50 p-4 text-sm text-amber-950">
            Microsoft 365 is optional and currently{" "}
            {connector.data?.configured
              ? "awaiting an authorized administrator connection"
              : "unavailable until provider credentials are configured"}
            .
          </p>
          <strong>One-way migration contract</strong>
          <p className="text-sm">
            Authorized administrators select supported content, preview
            permission mapping and conflicts, then explicitly confirm
            activation. Approved records are copied with provenance, external
            IDs, import timestamps, deduplication, progress, errors, and audit
            events.
          </p>
          <p className="text-sm font-medium">
            After activation, VNDRLY is authoritative. Work Hub never sends
            edits, acknowledgements, approvals, assignments, or new records back
            to Microsoft.
          </p>
          <BrandPillButton tone="brand" disabled title="Available when Microsoft 365 credentials are configured">Connect Microsoft 365</BrandPillButton>
        </CardContent>
      </Card>
      {canManage && <Card className="mt-4">
        <CardHeader><CardTitle>Audit history</CardTitle></CardHeader>
        <CardContent className="grid gap-2">
          <Notice error={audit.error} />
          {audit.data?.map((entry) => <article key={entry.id} className="rounded-lg border p-3">
            <p className="font-semibold">{String(entry.action).replaceAll(".", " ")}</p>
            <p className="text-xs text-muted-foreground">{entry.actorName ?? `User ${entry.actorUserId}`} · {entry.subjectType} · {displayDate(entry.createdAt)}</p>
          </article>)}
          {!audit.data?.length && <Empty>No Work Hub administrative activity yet.</Empty>}
        </CardContent>
      </Card>}
    </Shell>
  );
}
function Home() {
  const home = useQuery<Row>({
    queryKey: ["work-hub", "home"],
    queryFn: () => workHubRequest("/home"),
    retry: false,
  });
  return (
    <section
      className="mx-auto max-w-7xl p-4 md:p-8"
      data-testid="work-hub-home"
    >
      <p className="text-xs font-semibold uppercase tracking-[.2em] text-muted-foreground">
        Work Hub
      </p>
      <h1 className="mt-1 text-3xl font-bold">
        One place for the work around the work.
      </h1>
      <p className="mt-2 text-muted-foreground">
        Coordinate conversations, schedules, tasks, files, forms, and meetings
        inside VNDRLY.
      </p>
      <Notice error={home.error} />
      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        {[
          ["Active tasks", home.data?.tasks],
          ["Announcements", home.data?.announcements],
          ["Upcoming shifts", home.data?.shifts],
          ["Meetings", home.data?.meetings],
        ].map(([label, rows]) => (
          <Card key={String(label)}>
            <CardContent className="p-4">
              <strong>{Array.isArray(rows) ? rows.length : 0}</strong>
              <p className="text-xs text-muted-foreground">{String(label)}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Object.entries(MODULES).map(([key, [title, description, Icon]]) => (
          <a key={key} href={`/work-hub/${key}`}>
            <Card className="h-full hover:-translate-y-0.5">
              <CardHeader>
                <Icon className="h-5 w-5 text-[var(--brand-primary)]" />
                <CardTitle>{title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {description}
              </CardContent>
            </Card>
          </a>
        ))}
      </div>
    </section>
  );
}
export default function WorkHubPage() {
  const [location] = useLocation();
  const module = location.split("/")[2] as ModuleKey | undefined;
  if (!module) return <Home />;
  const pages: Record<ModuleKey, ReactNode> = {
    channels: <Channels />,
    calendar: <CalendarModule />,
    files: <FilesModule />,
    tasks: <TasksModule />,
    meetings: <MeetingsModule />,
    search: <SearchModule />,
    settings: <SettingsModule />,
  };
  return pages[module] ?? <Home />;
}
