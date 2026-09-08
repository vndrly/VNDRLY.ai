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
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import {
  commandEnvelope,
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
              crypto.randomUUID(),
              expectedVersion,
            ),
          ),
        }),
      onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    }),
  };
}

function Channels() {
  const owner = useOwner();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string>();
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState({ title: "", body: "" });
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
  const create = useMutation({
    mutationFn: () =>
      workHubRequest("/channels", {
        method: "POST",
        body: JSON.stringify(commandEnvelope(owner!, { name })),
      }),
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: ["work-hub", "channels"] });
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
  return (
    <Shell module="channels">
      <div className="grid gap-4 lg:grid-cols-[260px_1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Channels</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <Input
                aria-label="Channel name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="New channel"
              />
              <Button size="sm" disabled={!owner || !name}>
                Add
              </Button>
            </form>
            {channels.data?.map((c) => (
              <Button
                key={c.id}
                variant={c.id === active ? "default" : "ghost"}
                className="justify-start"
                onClick={() => setSelected(c.id)}
              >
                # {c.name}
              </Button>
            ))}
            {!channels.data?.length && <Empty>No channels yet.</Empty>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Conversation</CardTitle>
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
                send.mutate();
              }}
            >
              <Textarea
                aria-label="Message"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write a message…"
              />
              <Button disabled={!active || !body}>Send message</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
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
              <Button
                variant="outline"
                disabled={!active || !note.title || !note.body}
              >
                Save note
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}

function CalendarModule() {
  const now = new Date();
  const end = new Date(now);
  end.setMonth(end.getMonth() + 2);
  const calendar = useQuery<Row>({
    queryKey: ["work-hub", "calendar"],
    queryFn: () =>
      workHubRequest(
        `/calendar?start=${now.toISOString()}&end=${end.toISOString()}`,
      ),
  });
  const { owner, command } = useCommand("/shifts", ["work-hub", "calendar"]);
  const [form, setForm] = useState({
    title: "",
    startsAt: "",
    endsAt: "",
    assignees: "",
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
  return (
    <Shell module="calendar">
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming work</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {items.map((i) => (
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
            {!items.length && <Empty>No scheduled work in this range.</Empty>}
          </CardContent>
        </Card>
        <Card>
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
              <Notice error={command.error} />
              <Button disabled={!owner}>Publish shift</Button>
            </form>
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
            <Button disabled={!owner}>Publish and assign</Button>
          </form>
          <Notice error={publish.error ?? acknowledge.error} />
          {data?.announcements?.map((row: Row) => (
            <article key={row.id} className="rounded-lg border p-3">
              <strong>{row.title}</strong>
              <p className="text-sm text-muted-foreground">{row.body}</p>
              {row.acknowledgementRequired && (
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  onClick={() => acknowledge.mutate(row.id)}
                >
                  Acknowledge
                </Button>
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
            <Button disabled={!owner}>Request ordered approval</Button>
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
                  <Button
                    size="sm"
                    onClick={() =>
                      decide.mutate({ id: row.id, decision: "approved" })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      decide.mutate({ id: row.id, decision: "rejected" })
                    }
                  >
                    Reject
                  </Button>
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
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          update.mutate({ row, status: "in_progress" })
                        }
                      >
                        Start
                      </Button>
                    )}
                    {row.status !== "completed" && (
                      <Button
                        size="sm"
                        onClick={() =>
                          update.mutate({ row, status: "completed" })
                        }
                      >
                        Complete
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            ))}
            {!tasks.data?.length && <Empty>No tasks yet.</Empty>}
          </CardContent>
        </Card>
        <Card>
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
              <Button disabled={!owner}>Assign</Button>
            </form>
          </CardContent>
        </Card>
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
                <Button
                  className="mt-3"
                  size="sm"
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
                </Button>
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
              <Button
                className="mt-3"
                size="sm"
                onClick={() =>
                  respond.mutate({
                    kind: "form",
                    instance,
                    values: formValues[instance.id] ?? {},
                  })
                }
              >
                Submit form
              </Button>
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
                  <Button
                    size="sm"
                    onClick={() =>
                      respond.mutate({
                        kind: "approval",
                        instance: row,
                        decision: "approved",
                      })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      respond.mutate({
                        kind: "approval",
                        instance: row,
                        decision: "rejected",
                      })
                    }
                  >
                    Reject
                  </Button>
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
      <Card className="mt-4">
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
            <Button disabled={!owner}>Publish template</Button>
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
                <Button
                  className="mt-3"
                  size="sm"
                  variant="outline"
                  disabled={!owner || !Number(task.assignee)}
                  onClick={() => assignTemplate.mutate(row)}
                >
                  Assign to user {task.assignee || "…"}
                </Button>
              </article>
            ))}
          </div>
        </CardContent>
      </Card>
      <Governance owner={owner} data={admin.data} />
    </Shell>
  );
}

function MeetingsModule() {
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
  return (
    <Shell module="meetings">
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
              </article>
            ))}
            {!calendar.data?.meetings?.length && (
              <Empty>No meetings scheduled.</Empty>
            )}
          </CardContent>
        </Card>
        <Card>
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
              <Button disabled={!owner}>Schedule and invite</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
function FilesModule() {
  const files = useQuery<Row[]>({
    queryKey: ["work-hub", "files"],
    queryFn: () => workHubRequest("/files"),
  });
  return (
    <Shell module="files">
      <Card>
        <CardHeader>
          <CardTitle>Finalized files</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <Notice error={files.error} />
          {files.data?.map((f) => (
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
              </div>
              <span className="text-xs uppercase">{f.state}</span>
            </article>
          ))}
          {!files.data?.length && (
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
  const results = useQuery<Row[]>({
    queryKey: ["work-hub", "search", term],
    queryFn: () => workHubRequest(`/search?q=${encodeURIComponent(term)}`),
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
            className="flex gap-2"
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
            <Button>Search</Button>
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
  const connector = useQuery<Row>({
    queryKey: ["work-hub", "microsoft"],
    queryFn: () => workHubRequest("/connectors/microsoft-365"),
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
          <Button disabled>Connect Microsoft 365</Button>
        </CardContent>
      </Card>
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
