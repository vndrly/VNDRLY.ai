import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Hash, Star, Search, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  commandEnvelope,
  createWorkHubOperationId,
  ownerForUser,
  isWorkHubAdmin,
  workHubRequest,
} from "@/lib/work-hub-client";
import BrandPillButton from "@/components/brand-pill-button";
import MiniCardDialogContent from "@/components/mini-card-dialog-content";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useHubPreferences } from "./navigation";
import {
  BrandedInput,
  BrandedSelect,
  WorkHubPageHeading,
  WORK_HUB_CARD_CLASS,
  WORK_HUB_SUBCARD_CLASS,
} from "./chrome";
import { ActivityDashboard } from "./activity-dashboard";

type Row = Record<string, any>;
export function displayMentionText(body: string, people: Row[]) {
  return body.replace(
    /@\[(\d+)\]/g,
    (_match, id: string) =>
      `@${people.find((person) => String(person.userId ?? person.id) === id)?.displayName ?? "teammate"}`,
  );
}
export function HubError({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="p-3 text-sm text-red-600">
      {error instanceof Error ? error.message : "Request failed"}
    </p>
  ) : null;
}
function useRows(path: string, enabled = true) {
  const { user } = useAuth();
  return useQuery<Row[]>({
    queryKey: ["work-hub", path, user?.userId, user?.activeMembershipId],
    queryFn: () => workHubRequest(path),
    enabled,
    refetchInterval: 15000,
  });
}

export function PeoplePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState("");
  const people = useRows(`/people?search=${encodeURIComponent(search)}`);
  return (
    <div className="grid gap-2">
      <BrandedInput
        aria-label="Find a person"
        placeholder="Search people by name or email"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <BrandedSelect
        aria-label="Person"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select a person</option>
        {people.data?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.displayName} {p.email ? `(${p.email})` : ""}
          </option>
        ))}
      </BrandedSelect>
      <HubError error={people.error} />
    </div>
  );
}

export function ActivityWorkspace() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const home = useQuery<Row>({
    queryKey: ["work-hub", "home", user?.userId, user?.activeMembershipId],
    queryFn: () => workHubRequest("/home"),
    refetchInterval: 15000,
  });
  const acknowledge = useMutation({
    mutationFn: (id: string) => workHubRequest(`/announcements/${id}/acknowledge`, { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-hub", "home"] }),
  });
  const activity = useRows("/activity");
  const people = useRows("/people");
  const channels = useRows("/channels");
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/work-hub/events", { withCredentials: true });
    source.onmessage = () => {
      void qc.invalidateQueries({ queryKey: ["work-hub", "home"] });
      void qc.invalidateQueries({ queryKey: ["work-hub", "/activity"] });
    };
    return () => source.close();
  }, [qc]);

  const now = Date.now();
  const announcements = home.data?.announcements ?? [];
  const tasks = home.data?.tasks ?? [];
  const timeSensitive = announcements.filter(({ announcement }: Row) => announcement.urgency === "urgent");
  const important = announcements.filter(({ announcement, recipient }: Row) => announcement.urgency !== "urgent" && announcement.acknowledgementRequired && !recipient.acknowledgedAt);
  const stale = tasks.filter((task: Row) => task.status !== "completed" && new Date(task.updatedAt ?? task.createdAt ?? task.dueAt).getTime() < now - 30 * 86_400_000);
  const calendar = [
    ...(home.data?.shifts ?? []).map(({ shift }: Row) => ({ id: `shift-${shift.id}`, title: shift.title ?? "Scheduled shift", at: shift.startsAt, href: "/work-hub/calendar" })),
    ...(home.data?.meetings ?? []).map(({ meeting, occurrence }: Row) => ({ id: `meeting-${occurrence.id}`, title: meeting.title ?? "Meeting", at: occurrence.startsAt, href: `/work-hub/meetings?meeting=${occurrence.id}` })),
    ...tasks.filter((task: Row) => task.dueAt).map((task: Row) => ({ id: `task-${task.id}`, title: task.title ?? "Task due", at: task.dueAt, href: `/work-hub/tasks?task=${task.id}` })),
  ].filter((entry) => new Date(entry.at).getTime() >= now).sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()).slice(0, 5);
  const reviewItems = home.data?.reviewItems ?? [];

  const announcementCard = ({ announcement, recipient }: Row) => (
    <article key={announcement.id} data-work-hub-card className={`${WORK_HUB_SUBCARD_CLASS} p-4`}>
      {announcement.urgency === "urgent" && <p className="font-semibold text-red-600">Urgent</p>}
      <h3 className="font-semibold">{announcement.title}</h3>
      <p className="whitespace-pre-wrap text-sm">{announcement.body}</p>
      {announcement.deepLink && <a className="mt-2 inline-block text-sm underline" href={announcement.deepLink}>Open item</a>}
      {announcement.acknowledgementRequired && (recipient.acknowledgedAt
        ? <p className="mt-2 text-sm">Acknowledged</p>
        : <BrandPillButton className="mt-2" tone="brand" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate(announcement.id)}>Acknowledge</BrandPillButton>)}
    </article>
  );

  return (
    <section aria-label="Activity workspace" data-testid="work-hub-activity" className="w-full space-y-5 bg-background p-4 md:p-6">
      <WorkHubPageHeading module="activity" title="Activity" description="Recent conversations across your company and shared Crews." backFallbackHref="/" />
      <div data-testid="activity-primary-card" data-work-hub-card className={`w-full p-5 md:p-6 ${WORK_HUB_CARD_CLASS}`}>
        <HubError error={home.error ?? acknowledge.error} />
        <ActivityDashboard home={home.data} channels={channels.data} onAcknowledge={(id) => acknowledge.mutate(id)} acknowledging={acknowledge.isPending} />
        {!!stale.length && <section aria-label="Activity inactive for thirty days" className="mb-5 grid gap-3"><h2 className="text-lg font-semibold">No action for 30 days</h2>{stale.map((task: Row) => <a key={task.id} href={`/work-hub/tasks?task=${task.id}`} className={`${WORK_HUB_SUBCARD_CLASS} p-4 text-sm`}>{task.title}</a>)}</section>}
        <div className="mb-5 grid gap-5 lg:grid-cols-2">
          <section aria-label="Upcoming calendar" className={`${WORK_HUB_SUBCARD_CLASS} p-4`}><h2 className="font-semibold">Next on your calendar</h2>{calendar.length ? <ol className="mt-3 grid gap-2">{calendar.map((entry) => <li key={entry.id}><a href={entry.href} className="text-sm underline">{entry.title} · {new Date(entry.at).toLocaleString()}</a></li>)}</ol> : <p className="mt-2 text-sm text-muted-foreground">No upcoming items.</p>}</section>
          <section aria-label="Documents needing review" className={`${WORK_HUB_SUBCARD_CLASS} p-4`}><h2 className="font-semibold">Needs review</h2>{reviewItems.length ? <ul className="mt-3 grid gap-2">{reviewItems.map((item: Row) => <li key={item.id}><a href={item.deepLink ?? "/work-hub/files"} className="text-sm underline">{item.title ?? item.fileName}</a></li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">No documents need review.</p>}</section>
        </div>
        <div role="search" aria-label="Search activity" className="my-5">
          <Input className="rounded-lg border-2 border-[color:var(--brand-primary)] bg-white shadow-none focus-visible:ring-[color:var(--brand-primary)]" aria-label="Filter activity" placeholder="Search activity" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <HubError error={activity.error} />
        {activity.isLoading && <p role="status">Loading activity…</p>}
        <div data-testid="activity-feed" className="divide-y rounded-xl border-2 border-border bg-card">
          {activity.data?.filter((x) => `${displayMentionText(x.body, people.data ?? [])} ${x.channelName}`.toLowerCase().includes(search.toLowerCase())).map((x) => (
            <a key={x.id} href={`/work-hub/channels?channel=${x.channelId}`} className="flex gap-4 p-5 hover:bg-muted">
              <MessageSquare className="mt-1 h-5 w-5 text-[var(--brand-primary)]" />
              <div><h2 className="font-semibold">{x.channelName}</h2><p className="line-clamp-2 text-sm">{displayMentionText(x.body, people.data ?? [])}</p><time className="text-xs text-muted-foreground">{new Date(x.createdAt).toLocaleString()}</time></div>
            </a>
          ))}
        </div>
        {!activity.isLoading && !activity.data?.length && <p className="py-12 text-center text-muted-foreground">Your activity will appear here as your team collaborates.</p>}
      </div>
    </section>
  );
}

export function CollaborationWorkspace({ chat = false }: { chat?: boolean }) {
  const { user } = useAuth();
  const owner = ownerForUser(user);
  const qc = useQueryClient();
  const { preferences, save } = useHubPreferences();
  const channels = useRows(chat ? "/chats" : "/channels");
  const crews = useRows("/crews", !chat);
  const invitations = useRows("/invitations", chat);
  const [selected, setSelected] = useState(
    () => new URLSearchParams(window.location.search).get("channel") ?? "",
  );
  const [crew, setCrew] = useState("");
  const [crewEditor, setCrewEditor] = useState<Row | null>(null);
  const [crewName, setCrewName] = useState("");
  const [channelName, setChannelName] = useState("");
  const [memberRole, setMemberRole] = useState("member");
  const crewChannels = useRows(`/crews/${crew}/channels`, !!crew);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [person, setPerson] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [visibility, setVisibility] = useState("crew");
  const [tab, setTab] = useState("conversation");
  const [thread, setThread] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Row | null>(null);
  const [note, setNote] = useState({ title: "", body: "" });
  const [editingNote, setEditingNote] = useState<Row | null>(null);
  const list = crew ? crewChannels.data : channels.data;
  const active = selected || list?.[0]?.id;
  const channel =
    list?.find((c) => c.id === active) ??
    channels.data?.find((c) => c.id === active);
  const channelOwner = channel
    ? { type: channel.ownerOrgType, id: channel.ownerOrgId }
    : owner;
  const messages = useRows(`/channels/${active}/messages`, !!active);
  const notes = useRows(`/channels/${active}/notes`, !!active);
  const members = useRows(`/channels/${active}/members`, !!active);
  const crewMembers = useRows(`/crews/${crew}/members`, !!crew);
  const body = drafts[active] ?? preferences.drafts[active] ?? "";
  const canManageCrew = ["admin", "owner"].includes(
    crews.data?.find((c) => c.id === crew)?.role,
  );
  const canManageChannel =
    isWorkHubAdmin(user) ||
    canManageCrew ||
    channel?.createdById === user?.userId ||
    members.data?.some(
      (member) => member.userId === user?.userId && member.mode === "owner",
    );
  const canAdministerChannels = isWorkHubAdmin(user);
  const retryOperations = useRef(new Map<string, string>());
  const mutation = useMutation({
    mutationFn: async ({
      path,
      method = "POST",
      data,
    }: {
      path: string;
      method?: string;
      data: unknown;
    }) => {
      const { operationId: _discarded, ...payload } = data as Row;
      const key = `${method}:${path}:${JSON.stringify(payload)}`;
      if (!retryOperations.current.has(key))
        retryOperations.current.set(key, createWorkHubOperationId());
      const result = await workHubRequest<Row>(path, {
        method,
        body: JSON.stringify({
          ...payload,
          operationId: retryOperations.current.get(key),
        }),
      });
      retryOperations.current.delete(key);
      return result;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["work-hub"] });
    },
  });
  useEffect(() => {
    setThread(null);
    setEditing(null);
  }, [active]);
  useEffect(() => {
    if (!active || !messages.data?.[0]?.id) return;
    void workHubRequest(`/channels/${active}/read-cursor`, {
      method: "PUT",
      body: JSON.stringify({ lastMessageId: messages.data[0].id }),
    }).catch(() => undefined);
  }, [active, messages.data?.[0]?.id]);
  async function send() {
    if (!channelOwner || !body.trim()) return;
    await mutation.mutateAsync({
      path: `/channels/${active}/messages${editing ? `/${editing.id}` : ""}`,
      method: editing ? "PATCH" : "POST",
      data: commandEnvelope(
        channelOwner,
        {
          body,
          mentionUserIds: [
            ...new Set(
              [...body.matchAll(/@\[(\d+)\]/g)]
                .map((m) => Number(m[1]))
                .concat(
                  (members.data ?? [])
                    .filter((member) => body.includes(`@${member.displayName}`))
                    .map((member) => Number(member.userId ?? member.id)),
                ),
            ),
          ],
          ...(thread && !editing
            ? { rootMessageId: thread, parentMessageId: thread }
            : {}),
        },
        undefined,
        editing?.version,
      ),
    });
    setDrafts((d) => ({ ...d, [active]: "" }));
    setEditing(null);
    save.mutate({ drafts: { ...preferences.drafts, [active]: "" } });
  }
  const visible = list?.filter(
    (c) =>
      `${c.name}`.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "unread" && c.unreadCount > 0) ||
        (filter === "favorites" && preferences.favorites.includes(c.id)) ||
        (filter === "drafts" && !!(drafts[c.id] ?? preferences.drafts[c.id]))),
  );
  const shownMessages = [...(messages.data ?? [])]
    .reverse()
    .filter((m) =>
      thread ? m.id === thread || m.rootMessageId === thread : !m.rootMessageId,
    );
  return (
    <section className="w-full space-y-4 bg-background p-4" data-testid={chat ? "work-hub-chat" : "work-hub-channels"}>
      <WorkHubPageHeading module={chat ? "chat" : "channels"} title={chat ? "Direct Chat" : "Crews & Channels"} compact />
      <div className="grid min-h-[calc(100vh-12rem)] gap-4 lg:grid-cols-[minmax(340px,380px)_minmax(0,1fr)]">
      <aside
        aria-label="Conversations panel"
        data-work-hub-card
        className={`min-w-0 space-y-4 p-4 ${WORK_HUB_CARD_CLASS}`}
      >
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            className="rounded-lg border-2 border-[color:var(--brand-primary)] bg-white pl-9 shadow-none focus-visible:ring-[color:var(--brand-primary)]"
            aria-label="Find conversations"
            placeholder="Find a conversation"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <BrandedSelect
          aria-label="Conversation filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          {["all", "unread", "favorites", "drafts"].map((x) => (
            <option key={x} value={x}>
              {x[0].toUpperCase() + x.slice(1)}
            </option>
          ))}
        </BrandedSelect>
        {!chat && (
          <BrandedSelect
            aria-label="Crew"
            value={crew}
            onChange={(e) => {
              const crewId = e.target.value;
              const selectedCrew = crews.data?.find((item) => item.id === crewId) ?? null;
              setCrew(crewId);
              setSelected("");
              setCrewEditor(selectedCrew);
              setCrewName(selectedCrew?.name ?? "");
            }}
          >
            <option value="">All channels</option>
            {crews.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </BrandedSelect>
        )}
        <HubError error={channels.error ?? crews.error} />
        {channels.isLoading && <p role="status">Loading conversations…</p>}
        <nav aria-label="Conversations" className="space-y-1">
          {visible?.map((c) => (
            <div
              key={c.id}
              className={`flex items-center rounded-lg ${active === c.id ? "bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)]" : "hover:bg-muted"}`}
            >
              <button
                className="min-w-0 flex-1 p-3 text-left"
                onClick={() => setSelected(c.id)}
              >
                <span className="flex items-center gap-2 font-medium">
                  <Hash className="h-4 w-4" />
                  {c.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {(drafts[c.id] ?? preferences.drafts[c.id])
                    ? "Draft saved"
                    : c.unreadCount
                      ? `${c.unreadCount} unread messages`
                      : (c.lastMessageBody ?? "Open conversation")}
                </span>
              </button>
              <button
                className="p-2"
                aria-label={`${preferences.favorites.includes(c.id) ? "Unfavorite" : "Favorite"} ${c.name}`}
                onClick={() =>
                  save.mutate({
                    favorites: preferences.favorites.includes(c.id)
                      ? preferences.favorites.filter((id) => id !== c.id)
                      : [...preferences.favorites, c.id],
                  })
                }
              >
                <Star
                  className={`h-4 w-4 ${preferences.favorites.includes(c.id) ? "fill-amber-400 text-amber-500" : ""}`}
                />
              </button>
            </div>
          ))}
        </nav>
        {!visible?.length && !channels.isLoading && (
          <p className="text-sm text-muted-foreground">
            No conversations match this view.
          </p>
        )}
        {!chat && (
          <>
            <section
              role="region"
              aria-label="Manage crews and channels"
              className="grid gap-3 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-3"
            >
              <h2 className="text-sm font-semibold">Manage Crews & channels</h2>
              <BrandedSelect
                aria-label="Manage selected crew"
                value={crew}
                onChange={(event) => {
                  const crewId = event.target.value;
                  const selectedCrew = crews.data?.find((item) => item.id === crewId) ?? null;
                  setCrew(crewId);
                  setSelected("");
                  setCrewEditor(selectedCrew);
                  setCrewName(selectedCrew?.name ?? "");
                }}
              >
                <option value="">Select a crew to manage</option>
                {crews.data?.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </BrandedSelect>
              <BrandedInput
                aria-label="New crew name"
                placeholder="New crew name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              {isWorkHubAdmin(user) && (
                <BrandPillButton
                  tone="blue"
                  disabled={!name.trim() || !owner || mutation.isPending}
                  onClick={() =>
                    mutation
                      .mutateAsync({ path: "/crews", data: { owner, name } })
                      .then(() => setName(""))
                      .catch(() => undefined)
                  }
                >
                  Create Crew
                </BrandPillButton>
              )}
              <div className="grid gap-2">
                {crews.data?.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={`Edit ${item.name}`}
                    className="rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-3 text-left text-sm font-semibold hover:bg-[color-mix(in_srgb,var(--brand-primary)_10%,white)]"
                    onClick={() => {
                      setCrew(item.id);
                      setSelected("");
                      setCrewEditor(item);
                      setCrewName(item.name);
                    }}
                  >
                    {item.name}
                  </button>
                ))}
                {!crews.isLoading && !crews.data?.length && (
                  <p className="text-sm text-muted-foreground">No crews have been created yet.</p>
                )}
              </div>
            </section>
            <Dialog open={Boolean(crewEditor)} onOpenChange={(open) => { if (!open) setCrewEditor(null); }}>
              {crewEditor && (
                <MiniCardDialogContent
                  icon={Users}
                  label={`Edit ${crewEditor.name}`}
                  definition="Rename this crew, manage its channels and member roles, or archive or delete it."
                  iconColor="var(--brand-primary)"
                  className="max-h-[86vh] sm:max-w-2xl"
                >
                  <section className="grid gap-3 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4">
                    <label className="text-sm font-semibold" htmlFor="crew-name">Crew name</label>
                    <BrandedInput id="crew-name" aria-label="Crew name" value={crewName} onChange={(event) => setCrewName(event.target.value)} />
                    <BrandPillButton
                      tone="blue"
                      disabled={!crewName.trim() || mutation.isPending}
                      onClick={() => mutation.mutateAsync({ path: `/crews/${crewEditor.id}`, method: "PATCH", data: { name: crewName } }).then(() => setCrewEditor({ ...crewEditor, name: crewName })).catch(() => undefined)}
                    >
                      Save crew name
                    </BrandPillButton>
                  </section>

                  <section className="grid gap-3 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4">
                    <h3 className="font-semibold">Channels</h3>
                    {crewChannels.data?.map((item) => (
                      <button key={item.id} type="button" className="rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-3 text-left" onClick={() => { setSelected(item.id); setCrewEditor(null); }}>{item.name}</button>
                    ))}
                    {!crewChannels.data?.length && <p className="text-sm text-muted-foreground">No channels in this crew.</p>}
                    {canAdministerChannels && (
                      <>
                    <BrandedInput aria-label="New channel name" placeholder="New channel name" value={channelName} onChange={(event) => setChannelName(event.target.value)} />
                    <BrandedSelect aria-label="Channel visibility" value={visibility} onChange={(event) => setVisibility(event.target.value)}>
                      <option value="crew">Entire Crew</option>
                      <option value="private">Private</option>
                      <option value="shared">Shared</option>
                    </BrandedSelect>
                    <BrandPillButton tone="blue" disabled={!channelName.trim() || mutation.isPending} onClick={() => mutation.mutateAsync({ path: `/crews/${crewEditor.id}/channels`, data: { name: channelName, visibility } }).then(() => setChannelName("")).catch(() => undefined)}>Add channel</BrandPillButton>
                      </>
                    )}
                  </section>

                  <section className="grid gap-3 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4">
                    <h3 className="font-semibold">Members and roles</h3>
                    {crewMembers.data?.map((member) => (
                      <div key={member.userId} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_150px] sm:items-center">
                        <span className="text-sm">{member.displayName}</span>
                        <BrandedSelect aria-label={`Role for ${member.displayName}`} value={member.mode} onChange={(event) => mutation.mutate({ path: `/crews/${crewEditor.id}/members`, data: { userId: Number(member.userId), mode: event.target.value } })}>
                          <option value="member">Member</option>
                          <option value="owner">Owner</option>
                        </BrandedSelect>
                        <BrandPillButton
                          tone="red"
                          aria-label={`Remove ${member.displayName}`}
                          disabled={mutation.isPending}
                          onClick={() => mutation.mutate({ path: `/crews/${crewEditor.id}/members/${member.userId}`, method: "DELETE", data: {} })}
                        >
                          Remove member
                        </BrandPillButton>
                      </div>
                    ))}
                    <PeoplePicker value={person} onChange={setPerson} />
                    <BrandedSelect aria-label="New member role" value={memberRole} onChange={(event) => setMemberRole(event.target.value)}>
                      <option value="member">Member</option>
                      <option value="owner">Owner</option>
                    </BrandedSelect>
                    <BrandPillButton tone="blue" disabled={!person || mutation.isPending} onClick={() => mutation.mutate({ path: `/crews/${crewEditor.id}/members`, data: { userId: Number(person), mode: memberRole } })}>Add or update member</BrandPillButton>
                  </section>

                  {isWorkHubAdmin(user) && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <BrandPillButton tone="brand" disabled={mutation.isPending} onClick={() => mutation.mutateAsync({ path: `/crews/${crewEditor.id}/archive`, data: {} }).then(() => { setCrewEditor(null); setCrew(""); }).catch(() => undefined)}>Archive crew</BrandPillButton>
                      <BrandPillButton tone="red" disabled={mutation.isPending} onClick={() => { if (window.confirm("Delete this crew? It will be removed from active crew lists. Its audit history will be retained.")) mutation.mutateAsync({ path: `/crews/${crewEditor.id}`, method: "DELETE", data: {} }).then(() => { setCrewEditor(null); setCrew(""); }).catch(() => undefined); }}>Delete crew</BrandPillButton>
                    </div>
                  )}
                  <HubError error={mutation.error} />
                </MiniCardDialogContent>
              )}
            </Dialog>
          </>
        )}
        {chat && (        <details className="border-t pt-4">
          <summary className="cursor-pointer text-sm font-semibold">
            {chat ? "New chat" : "Manage Crews & channels"}
          </summary>
          <div className="mt-3 grid gap-3">
            {chat ? (
              <>
                <PeoplePicker value={person} onChange={setPerson} />
                <BrandPillButton
                  className="w-fit max-w-full justify-self-start"
                  tone="blue"
                  disabled={!person || mutation.isPending}
                  onClick={() =>
                    mutation
                      .mutateAsync({
                        path: "/chats",
                        data: { recipientUserId: Number(person) },
                      })
                      .then((r) => {
                        if (r.channel) setSelected(r.channel.id);
                        setPerson("");
                      })
                      .catch(() => undefined)
                  }
                >
                  Start chat / send invitation
                </BrandPillButton>
                {invitations.data
                  ?.filter(
                    (i) =>
                      i.status === "pending" &&
                      i.recipientUserId === user?.userId,
                  )
                  .map((i) => (
                    <div key={i.id} className="rounded border p-2 text-sm">
                      Chat invitation from{" "}
                      {i.senderName ?? `user ${i.senderUserId}`}
                      <div className="mt-2 flex gap-2">
                        {[true, false].map((accept) => (
                          <BrandPillButton
                            key={String(accept)}
                            tone={accept ? "green" : "red"}
                            onClick={() =>
                              mutation.mutate({
                                path: `/invitations/${i.id}/respond`,
                                data: { accept },
                              })
                            }
                          >
                            {accept ? "Accept" : "Decline"}
                          </BrandPillButton>
                        ))}
                      </div>
                    </div>
                  ))}
              </>
            ) : (
              <>
                <Input
                  aria-label="Crew or channel name"
                  placeholder="Crew or channel name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                {isWorkHubAdmin(user) && (
                  <BrandPillButton
                    tone="blue"
                    disabled={!name.trim() || !owner || mutation.isPending}
                    onClick={() =>
                      mutation
                        .mutateAsync({ path: "/crews", data: { owner, name } })
                        .then(() => setName(""))
                        .catch(() => undefined)
                    }
                  >
                    Create Crew
                  </BrandPillButton>
                )}
                {!crew && isWorkHubAdmin(user) && (
                  <BrandPillButton
                    tone="blue"
                    disabled={!owner || !name.trim() || mutation.isPending}
                    onClick={() =>
                      mutation
                        .mutateAsync({
                          path: "/channels",
                          data: commandEnvelope(owner!, {
                            name,
                            visibility: "organization",
                          }),
                        })
                        .then(() => setName(""))
                        .catch(() => undefined)
                    }
                  >
                    Create company channel
                  </BrandPillButton>
                )}
                {crew && canAdministerChannels && (
                  <>
                    <BrandedSelect
                      aria-label="Channel visibility"
                      value={visibility}
                      onChange={(e) => setVisibility(e.target.value)}
                    >
                      <option value="crew">Entire Crew</option>
                      <option value="private">Private</option>
                      <option value="shared">Shared</option>
                    </BrandedSelect>
                    <BrandPillButton
                      tone="blue"
                      disabled={!name.trim() || mutation.isPending}
                      onClick={() =>
                        mutation
                          .mutateAsync({
                            path: `/crews/${crew}/channels`,
                            data: { name, visibility },
                          })
                          .then(() => setName(""))
                          .catch(() => undefined)
                      }
                    >
                      Add channel
                    </BrandPillButton>
                  </>
                )}
                {crew && canManageCrew && (
                  <>
                    <PeoplePicker value={person} onChange={setPerson} />
                    {["member", "owner"].map((mode) => (
                      <BrandPillButton
                        key={mode}
                        tone="blue"
                        disabled={!person || mutation.isPending}
                        onClick={() =>
                          mutation.mutate({
                            path: `/crews/${crew}/members`,
                            data: { userId: Number(person), mode },
                          })
                        }
                      >
                        Add Crew {mode}
                      </BrandPillButton>
                    ))}
                    {crewMembers.data?.map((m) => (
                      <p key={m.userId} className="text-xs">
                        {m.displayName} · {m.mode}
                      </p>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </details>
        )}
        <HubError error={mutation.error ?? save.error} />
      </aside>
      <main
        aria-label="Selected conversation workspace"
        className="grid min-w-0 content-start gap-4"
      >
        {active ? (
          <>
            <section
              aria-label="Selected channel"
              data-work-hub-card
              className={`w-full px-6 py-4 ${WORK_HUB_CARD_CLASS}`}
            >
              <h2 className="text-xl font-semibold">
                {channel?.name ?? "Conversation"}
              </h2>
              {!chat && canAdministerChannels && (
                <div className="mt-2">
                  <BrandPillButton
                    tone="red"
                    disabled={mutation.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Delete this channel? It will be removed from participant views. Audit history is retained.",
                        )
                      )
                        mutation
                          .mutateAsync({
                            path: `/channels/${active}`,
                            method: "DELETE",
                            data: commandEnvelope(channelOwner!, {}),
                          })
                          .then(() => setSelected(""))
                          .catch(() => undefined);
                    }}
                  >
                    Delete channel
                  </BrandPillButton>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2" role="tablist">
                {["conversation", "notes", "shared", "people"].map((x) => (
                  <BrandPillButton
                    key={x}
                    type="button"
                    tone="brand"
                    role="tab"
                    aria-selected={tab === x}
                    className="w-fit capitalize"
                    onClick={() => setTab(x)}
                  >
                    {x}
                  </BrandPillButton>
                ))}
              </div>
            </section>
            <div className="contents">
              <HubError error={messages.error ?? notes.error} />
              {tab === "conversation" && (
                <>
                  <section
                    aria-label="Channel content"
                    data-work-hub-card
                    className={`w-full min-h-[18rem] p-4 md:p-6 ${WORK_HUB_CARD_CLASS}`}
                  >
                  {thread && (
                    <div className="mb-4 flex items-center justify-between border-b pb-3">
                      <strong>Thread</strong>
                      <BrandPillButton
                        tone="blue"
                        onClick={() => setThread(null)}
                      >
                        Back to conversation
                      </BrandPillButton>
                    </div>
                  )}
                  <div className="min-h-48 space-y-4">
                    {shownMessages.map((m) => (
                      <article key={m.id} className="flex gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted font-semibold">
                          {String(m.authorName ?? m.authorUserId).slice(0, 2)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">
                            {m.authorName ?? `User ${m.authorUserId}`}{" "}
                            <time className="ml-2 text-xs font-normal text-muted-foreground">
                              {new Date(m.createdAt).toLocaleString()}
                              {m.editedAt ? " · Edited" : ""}
                            </time>
                          </p>
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                            {m.deletedAt
                              ? "Message deleted"
                              : displayMentionText(m.body, members.data ?? [])}
                          </p>
                          {!m.deletedAt && (
                            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                              <button
                                onClick={() =>
                                  setThread(m.rootMessageId ?? m.id)
                                }
                              >
                                Reply in thread
                              </button>
                              {["👍", "❤️", "✅"].map((emoji) => (
                                <button
                                  key={emoji}
                                  aria-label={`React ${emoji}`}
                                  onClick={() =>
                                    mutation.mutate({
                                      path: `/channels/${active}/messages/${m.id}/reactions`,
                                      data: commandEnvelope(channelOwner!, {
                                        emoji,
                                      }),
                                    })
                                  }
                                >
                                  {emoji}{" "}
                                  {m.reactions?.filter(
                                    (r: Row) => r.emoji === emoji,
                                  ).length || ""}
                                </button>
                              ))}
                              {m.authorUserId === user?.userId && (
                                <>
                                  <button
                                    onClick={() => {
                                      setEditing(m);
                                      setDrafts((d) => ({
                                        ...d,
                                        [active]: m.body,
                                      }));
                                    }}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() =>
                                      mutation.mutate({
                                        path: `/channels/${active}/messages/${m.id}`,
                                        method: "DELETE",
                                        data: commandEnvelope(
                                          channelOwner!,
                                          {},
                                          undefined,
                                          m.version,
                                        ),
                                      })
                                    }
                                  >
                                    Delete
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                  </section>
                  <form
                    aria-label="Message composer"
                    data-work-hub-card
                    className={`sticky bottom-4 grid w-full gap-3 p-4 ${WORK_HUB_CARD_CLASS}`}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void send().catch(() => undefined);
                    }}
                  >
                    {editing && (
                      <p className="text-sm">
                        Editing message{" "}
                        <button
                          type="button"
                          className="ml-3 underline"
                          onClick={() => {
                            setEditing(null);
                            setDrafts((d) => ({ ...d, [active]: "" }));
                          }}
                        >
                          Cancel
                        </button>
                      </p>
                    )}
                    <Textarea
                      aria-label="Message"
                      placeholder={
                        thread ? "Reply in thread…" : "Write a message…"
                      }
                      value={displayMentionText(body, members.data ?? [])}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [active]: e.target.value }))
                      }
                      onBlur={() => {
                        if (!editing)
                          save.mutate({
                            drafts: { ...preferences.drafts, [active]: body },
                          });
                      }}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <select
                        aria-label="Mention teammate"
                        className="max-w-48 rounded-lg border-2 border-[color:var(--brand-primary)] bg-background p-2 text-sm"
                        value=""
                        onChange={(e) =>
                          setDrafts((d) => ({
                            ...d,
                            [active]: `${displayMentionText(body, members.data ?? [])} @${members.data?.find((member) => String(member.userId ?? member.id) === e.target.value)?.displayName ?? "teammate"} `,
                          }))
                        }
                      >
                        <option value="">Mention teammate</option>
                        {members.data?.map((m) => (
                          <option
                            key={m.userId ?? m.id}
                            value={m.userId ?? m.id}
                          >
                            {m.displayName}
                          </option>
                        ))}
                      </select>
                      <BrandPillButton
                        tone="blue"
                        type="submit"
                        disabled={!body.trim() || mutation.isPending}
                      >
                        {editing ? "Save edit" : "Send message"}
                      </BrandPillButton>
                    </div>
                  </form>
                </>
              )}
              {tab === "notes" && (
                <div
                  role="region"
                  aria-label="Channel content"
                  data-work-hub-card
                  className={`grid w-full min-h-[18rem] gap-4 p-4 md:p-6 ${WORK_HUB_CARD_CLASS}`}
                >
                  {notes.data?.map((n) => (
                    <article key={n.id} className="rounded border p-4">
                      <h3 className="font-semibold">{n.title}</h3>
                      <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                      <BrandPillButton
                        tone="blue"
                        onClick={() => {
                          setEditingNote(n);
                          setNote({ title: n.title, body: n.body });
                        }}
                      >
                        Edit note
                      </BrandPillButton>
                    </article>
                  ))}
                  <form
                    className="grid gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      mutation
                        .mutateAsync({
                          path: `/channels/${active}/notes${editingNote ? `/${editingNote.id}` : ""}`,
                          method: editingNote ? "PATCH" : "POST",
                          data: commandEnvelope(
                            channelOwner!,
                            note,
                            undefined,
                            editingNote?.version,
                          ),
                        })
                        .then(() => {
                          setNote({ title: "", body: "" });
                          setEditingNote(null);
                        })
                        .catch(() => undefined);
                    }}
                  >
                    <Input
                      aria-label="Note title"
                      placeholder="Note title"
                      required
                      value={note.title}
                      onChange={(e) =>
                        setNote({ ...note, title: e.target.value })
                      }
                    />
                    <Textarea
                      aria-label="Note body"
                      required
                      value={note.body}
                      onChange={(e) =>
                        setNote({ ...note, body: e.target.value })
                      }
                    />
                    <BrandPillButton
                      tone="blue"
                      type="submit"
                      disabled={mutation.isPending}
                    >
                      Save note
                    </BrandPillButton>
                  </form>
                </div>
              )}
              {tab === "shared" && (
                <div
                  role="region"
                  aria-label="Channel content"
                  data-work-hub-card
                  className={`w-full min-h-[18rem] space-y-4 p-4 md:p-6 ${WORK_HUB_CARD_CLASS}`}
                >
                  <h3 className="font-semibold">Shared content</h3>
                  <a
                    href={`/work-hub/files?channel=${active}`}
                    className="text-[var(--brand-primary)] underline"
                  >
                    Open channel files and upload attachments
                  </a>
                  {messages.data
                    ?.filter((m) => /https?:\/\//.test(m.body))
                    .map((m) => (
                      <p
                        key={m.id}
                        className="whitespace-pre-wrap rounded border p-3 text-sm"
                      >
                        {m.body}
                      </p>
                    ))}
                </div>
              )}
              {tab === "people" && (
                <div
                  role="region"
                  aria-label="Channel content"
                  data-work-hub-card
                  className={`w-full min-h-[18rem] divide-y p-4 md:p-6 ${WORK_HUB_CARD_CLASS}`}
                >
                  {members.data?.map((m) => (
                    <div key={m.userId ?? m.id} className="py-3">
                      <strong>{m.displayName}</strong>
                      <p className="text-sm text-muted-foreground">
                        {m.email} · {m.mode ?? "Member"}
                      </p>
                    </div>
                  ))}
                  <HubError error={members.error} />
                  {!chat && canManageChannel && (
                    <details className="pt-4">
                      <summary className="cursor-pointer text-sm font-semibold">
                        Manage channel participants
                      </summary>
                      <div className="mt-3 grid max-w-md gap-3">
                        {channel?.visibility === "shared" ? (
                          <>
                            <PeoplePicker value={person} onChange={setPerson} />
                            <BrandPillButton
                              tone="blue"
                              disabled={!person || mutation.isPending}
                              onClick={() =>
                                mutation.mutate({
                                  path: `/channels/${active}/invitations`,
                                  data: { recipientUserId: Number(person) },
                                })
                              }
                            >
                              Invite to shared channel
                            </BrandPillButton>
                          </>
                        ) : (
                          <>
                            <Input
                              aria-label="Participant email"
                              type="email"
                              placeholder="Participant email"
                              value={memberEmail}
                              onChange={(e) => setMemberEmail(e.target.value)}
                            />
                            <BrandPillButton
                              tone="blue"
                              disabled={!memberEmail || mutation.isPending}
                              onClick={() =>
                                mutation.mutate({
                                  path: `/channels/${active}/members`,
                                  data: { email: memberEmail },
                                })
                              }
                            >
                              Add channel participant
                            </BrandPillButton>
                          </>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Channel owners and company administrators manage
                          participants. Shared invitations require acceptance.
                        </p>
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <section
            aria-label="Channel content"
            data-work-hub-card
            className={`flex min-h-96 w-full flex-col items-center justify-center gap-3 text-center text-muted-foreground ${WORK_HUB_CARD_CLASS}`}
          >
            <MessageSquare className="h-10 w-10 text-[var(--brand-primary)]" />
            <h2 className="text-lg font-bold text-black">Choose a conversation</h2>
            <p className="text-sm">
              Your company conversations and shared work live here.
            </p>
          </section>
        )}
      </main>
      </div>
    </section>
  );
}
