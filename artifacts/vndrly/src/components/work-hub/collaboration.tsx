import { NoteEditor } from "./note-editor";
import { NoteMessage } from "./note-message";
import { ReceiptEditor } from "./receipt-editor";
import { ConversationTitle } from "./conversation-title";
import { ConversationAttachments } from "./conversation-attachments";
import { ConversationTranscript } from "./conversation-transcript";
import { NotificationTree } from "./notification-tree";
import { NewChat } from "./new-chat";
import { NewChannel } from "./new-channel";
import { NewPoll, PollWorkspace, usePollCampaigns } from "./polls";
import { WorkHubFiles } from "./files";
import { ChatParticipants } from "./chat-participants";
import { MessageReactions } from "./message-reactions";
import "./collaboration.css";
import { useEffect, useRef, useState } from "react";
import { useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Hash, Star, Search, Users, Folder, StickyNote, ReceiptText, Trash2, ChevronRight, Check, Reply, Pencil, Vote, Menu, Plus, Layers3 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import {
  canCreateWorkHubChannels,
  canModerateWorkHubMessages,
  commandEnvelope,
  createWorkHubOperationId,
  ownerForUser,
  isWorkHubAdmin,
  workHubRequest,
} from "@/lib/work-hub-client";
import BrandPillButton from "@/components/brand-pill-button";
import SphereBackButton from "@/components/sphere-back-button";
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

type Row = Record<string, any>;
export function conversationCategory(channel: Row): "Channels" | "Chats" {
  if (channel.contextKind === "crew" || String(channel.contextId ?? "").startsWith("group:")) return "Channels";
  return channel.contextKind === "chat" ? "Chats" : "Channels";
}
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
            {p.displayName}
            {p.organizationName ? ` · ${p.organizationName}` : ""}
            {p.role ? ` · ${p.role}` : ""}
          </option>
        ))}
      </BrandedSelect>
      <HubError error={people.error} />
    </div>
  );
}

export { WorkHubHome as ActivityWorkspace } from "./home";

export function CollaborationWorkspace({ chat = false }: { chat?: boolean }) {
  const { user } = useAuth();
  const brand = useBrand();
  const owner = ownerForUser(user);
  const qc = useQueryClient();
  const { preferences, save } = useHubPreferences();
  const channels = useRows("/channels?limit=100", chat);
  const crews = useRows("/crews");
  const invitations = useRows("/invitations", chat);
  const [selected, setSelected] = useState(
    () => new URLSearchParams(window.location.search).get("channel") ?? "",
  );
  const searchParams = useSearch();
  const linkedChannelId = new URLSearchParams(searchParams).get("channel");
  const linkedChannels = useRows("/channels?limit=100", chat && !!linkedChannelId);
  useEffect(() => {
    if (linkedChannelId) setSelected(linkedChannelId);
  }, [linkedChannelId]);
  const [crew, setCrew] = useState("");
  const [crewEditor, setCrewEditor] = useState<Row | null>(null);
  const [crewName, setCrewName] = useState("");
  const [channelName, setChannelName] = useState("");
  const [memberRole, setMemberRole] = useState("member");
  const crewChannels = useRows(`/crews/${crew}/channels`, false);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [person, setPerson] = useState(() => chat ? new URLSearchParams(window.location.search).get("person") ?? "" : "");
  const [memberEmail, setMemberEmail] = useState("");
  const [visibility, setVisibility] = useState("crew");
  const [tab, setTab] = useState("conversation");
  const linkedReceiptId = new URLSearchParams(searchParams).get("receipt");
  useEffect(() => { if (linkedReceiptId) setTab("receipts"); }, [linkedReceiptId]);
  const [attachment, setAttachment] = useState<{ channelId: string; file: File } | null>(null);
  const [thread, setThread] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Row | null>(null);
  const [createPanel, setCreatePanel] = useState<"channel" | "chat" | "poll">("chat");
  const [createOpen, setCreateOpen] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(!linkedChannelId);
  const [controlsExpanded, setControlsExpanded] = useState(true);
  const restoredPreference = useRef(false);
  const [selectedPollId, setSelectedPollId] = useState("");
  const pollCampaigns = usePollCampaigns();
  useEffect(() => {
    if (linkedChannelId) setChooserOpen(false);
  }, [linkedChannelId]);


  const list = !chat && crew ? crewChannels.data : channels.data;
  const active = selected;
  const channel =
    list?.find((c) => c.id === active) ??
    channels.data?.find((c) => c.id === active);
  const channelOwner = channel
    ? { type: channel.ownerOrgType, id: channel.ownerOrgId }
    : owner;
  const messages = useRows(`/channels/${active}/messages`, !!active);
  const notes = useRows(`/channels/${active}/notes`, !!active);
  const members = useRows(`/channels/${active}/members`, !!active);
  const crewMembers = useRows(`/crews/${crew}/members`, !chat && !!crew);
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
  const canCreateChannels = canCreateWorkHubChannels(user);
  const canModerateMessages = canModerateWorkHubMessages(user);
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
    if (restoredPreference.current || linkedChannelId || !channels.data) return;
    restoredPreference.current = true;
    const remembered = channels.data.find(
      (item) => item.id === preferences.lastConversationId,
    );
    if (remembered) {
      setSelected(remembered.id);
      setChooserOpen(false);
      return;
    }
    setChooserOpen(true);
  }, [channels.data, linkedChannelId, preferences.lastConversationId]);
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
          mentionUserIds: [],
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
  function selectConversation(channelId: string) {
    setSelected(channelId);
    setSelectedPollId("");
    setChooserOpen(false);
    setCreateOpen(false);
    save.mutate({ lastConversationId: channelId });
  }
  function selectPoll(campaignId: string) {
    setSelectedPollId(campaignId);
    setChooserOpen(false);
    setCreateOpen(false);
  }
  const visible = list?.filter(
    (c) =>
      `${c.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  const visiblePolls = (pollCampaigns.polls ?? []).filter(
    (poll) => poll.title.toLowerCase().includes(search.toLowerCase()),
  );
  const selectedPoll = pollCampaigns.polls?.find(
    (poll) => poll.campaignId === selectedPollId,
  );
  const shownMessages = [...(messages.data ?? [])]
    .reverse()
    .filter((m) =>
      thread ? m.id === thread || m.rootMessageId === thread : !m.rootMessageId,
    );
  if (!chat) {
    return (
      <section className="w-full space-y-4 bg-background p-4" data-testid="work-hub-channels">
        <WorkHubPageHeading
          module="channels"
          title="Groups"
          description="Create groups, assign members and owners, and manage each group lifecycle."
          compact
        />
        <section
          role="region"
          aria-label="Manage groups"
          data-work-hub-card
          className={`grid w-full gap-4 p-4 md:p-6 ${WORK_HUB_CARD_CLASS}`}
        >
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <BrandedInput
              aria-label="New group name"
              placeholder="New group name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {isWorkHubAdmin(user) && (
              <BrandPillButton
                tone="brand"
                disabled={!name.trim() || !owner || mutation.isPending}
                onClick={() =>
                  mutation
                    .mutateAsync({ path: "/crews", data: { owner, name } })
                    .then(() => setName(""))
                    .catch(() => undefined)
                }
              >
                Create Group
              </BrandPillButton>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {crews.data?.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Edit ${item.name}`}
                className="rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4 text-left text-sm font-semibold hover:bg-[color-mix(in_srgb,var(--brand-primary)_10%,white)]"
                onClick={() => {
                  setCrew(item.id);
                  setCrewEditor(item);
                  setCrewName(item.name);
                }}
              >
                {item.name}
              </button>
            ))}
            {!crews.isLoading && !crews.data?.length && (
              <p className="text-sm text-muted-foreground">No groups have been created yet.</p>
            )}
          </div>
          <HubError error={crews.error ?? mutation.error} />
        </section>
        <Dialog
          open={Boolean(crewEditor)}
          onOpenChange={(open) => {
            if (!open) setCrewEditor(null);
          }}
        >
          {crewEditor && (
            <MiniCardDialogContent
              icon={Users}
              label={`Edit ${crewEditor.name}`}
              definition="Rename this group, manage member roles, archive it, or delete it."
              iconColor="var(--brand-primary)"
              className="max-h-[86vh] sm:max-w-2xl"
            >
              <section className="grid gap-3 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4">
                <label className="text-sm font-semibold" htmlFor="group-name">Group name</label>
                <BrandedInput
                  id="group-name"
                  aria-label="Group name"
                  value={crewName}
                  onChange={(event) => setCrewName(event.target.value)}
                />
                <BrandPillButton
                  tone="brand"
                  disabled={!crewName.trim() || mutation.isPending}
                  onClick={() =>
                    mutation
                      .mutateAsync({
                        path: `/crews/${crewEditor.id}`,
                        method: "PATCH",
                        data: { name: crewName },
                      })
                      .then(() => setCrewEditor({ ...crewEditor, name: crewName }))
                      .catch(() => undefined)
                  }
                >
                  Save group name
                </BrandPillButton>
              </section>
              <section className="grid gap-3 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4">
                <h3 className="font-semibold">Members and owners</h3>
                {crewMembers.data?.map((member) => (
                  <div key={member.userId} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_150px] sm:items-center">
                    <span className="text-sm">{member.displayName}</span>
                    <BrandedSelect
                      aria-label={`Role for ${member.displayName}`}
                      value={member.mode}
                      onChange={(event) =>
                        mutation.mutate({
                          path: `/crews/${crewEditor.id}/members`,
                          data: { userId: Number(member.userId), mode: event.target.value },
                        })
                      }
                    >
                      <option value="member">Member</option>
                      <option value="owner">Owner</option>
                    </BrandedSelect>
                    <BrandPillButton
                      tone="red"
                      aria-label={`Remove ${member.displayName}`}
                      disabled={mutation.isPending}
                      onClick={() =>
                        mutation.mutate({
                          path: `/crews/${crewEditor.id}/members/${member.userId}`,
                          method: "DELETE",
                          data: {},
                        })
                      }
                    >
                      Remove member
                    </BrandPillButton>
                  </div>
                ))}
                <PeoplePicker value={person} onChange={setPerson} />
                <BrandedSelect
                  aria-label="New member role"
                  value={memberRole}
                  onChange={(event) => setMemberRole(event.target.value)}
                >
                  <option value="member">Member</option>
                  <option value="owner">Owner</option>
                </BrandedSelect>
                <BrandPillButton
                  tone="brand"
                  disabled={!person || mutation.isPending}
                  onClick={() =>
                    mutation.mutate({
                      path: `/crews/${crewEditor.id}/members`,
                      data: { userId: Number(person), mode: memberRole },
                    })
                  }
                >
                  Add or update member
                </BrandPillButton>
              </section>
              {isWorkHubAdmin(user) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <BrandPillButton
                    tone="brand"
                    disabled={mutation.isPending}
                    onClick={() =>
                      mutation
                        .mutateAsync({ path: `/crews/${crewEditor.id}/archive`, data: {} })
                        .then(() => { setCrewEditor(null); setCrew(""); })
                        .catch(() => undefined)
                    }
                  >
                    Archive group
                  </BrandPillButton>
                  <BrandPillButton
                    tone="red"
                    disabled={mutation.isPending}
                    onClick={() => {
                      if (window.confirm("Delete this group? It will be removed from active group lists. Its audit history will be retained."))
                        mutation
                          .mutateAsync({ path: `/crews/${crewEditor.id}`, method: "DELETE", data: {} })
                          .then(() => { setCrewEditor(null); setCrew(""); })
                          .catch(() => undefined);
                    }}
                  >
                    Delete group
                  </BrandPillButton>
                </div>
              )}
              <HubError error={mutation.error} />
            </MiniCardDialogContent>
          )}
        </Dialog>
      </section>
    );
  }
  return (
    <section className="hub-chat-page w-full space-y-4 p-4" data-testid={chat ? "work-hub-chat" : "work-hub-channels"}>
      <WorkHubPageHeading module="chat" title="Conversations" compact />
      <div className="hub-conversation-layout grid gap-4" data-controls-collapsed={!controlsExpanded}>
      <aside
        aria-label="Conversations panel"
        data-work-hub-card
        className={`hub-conversations-panel min-w-0 p-4 ${WORK_HUB_CARD_CLASS}`}
        style={{ paddingTop: "8px", paddingLeft: "8px", paddingBottom: "9.6px" }}
      >
        <div
          className="hub-conversation-header flex items-center gap-1"
          style={{ position: "absolute", top: "8px", left: "8px", right: "16px", zIndex: 20 }}
        >
          <button
            type="button"
            className="group inline-flex items-center"
            aria-expanded={controlsExpanded}
            aria-label={controlsExpanded ? "Collapse conversation controls" : "Expand conversation controls"}
            title={controlsExpanded ? "Collapse conversation controls" : "Expand conversation controls"}
            onClick={() => {
              setTab("conversation");
              setCreateOpen(false);
              setChooserOpen(!controlsExpanded);
              setControlsExpanded((expanded) => !expanded);
            }}
          >
            <SphereBackButton size={40} overlay={<Layers3 className="lucide-layers-3 h-5 w-5" />} />
          </button>
          {controlsExpanded && (
            <div
              role="toolbar"
              aria-label="Conversation controls drawer"
              aria-orientation="horizontal"
              className="hub-conversation-drawer flex min-w-0 flex-1 items-center gap-1"
            >
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  className="hub-conversation-tool"
                  aria-label="Choose a conversation"
                  title="Choose a conversation"
                  aria-expanded={chooserOpen}
                  onClick={() => {
                    setChooserOpen((open) => !open);
                    setCreateOpen(false);
                    setTab("conversation");
                  }}
                >
                  <Menu className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="hub-conversation-tool"
                  aria-label="Create new"
                  title="Create new"
                  aria-expanded={createOpen}
                  onClick={() => {
                    setCreateOpen((open) => !open);
                    setChooserOpen(false);
                    setTab("conversation");
                  }}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
                {active && (
                  <button
                    type="button"
                    role="tab"
                    className="hub-conversation-tool"
                    aria-label={channel?.contextKind === "chat" ? "People" : "People and groups"}
                    title={channel?.contextKind === "chat" ? "People" : "People and groups"}
                    aria-selected={tab === "people"}
                    onClick={() => {
                      setChooserOpen(false);
                      setCreateOpen(false);
                      setTab((current) => current === "people" ? "conversation" : "people");
                    }}
                  >
                    <Users className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
                {active && channel?.contextKind !== "chat" && canAdministerChannels && (
                  <button
                    type="button"
                    className="hub-conversation-tool"
                    aria-label="Delete channel"
                    title="Delete channel"
                    disabled={mutation.isPending}
                    onClick={() => {
                      if (!window.confirm("Delete this channel? It will be removed from participant views. Audit history is retained.")) return;
                      mutation
                        .mutateAsync({
                          path: `/channels/${active}`,
                          method: "DELETE",
                          data: commandEnvelope(channelOwner!, {}),
                        })
                        .then(() => {
                          setSelected("");
                          setChooserOpen(true);
                          save.mutate({ lastConversationId: null });
                        })
                        .catch(() => undefined);
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              {active && (
                <>
                  <div
                    role="separator"
                    aria-label="Conversation control groups"
                    aria-orientation="vertical"
                    className="mx-1 h-6 w-px shrink-0 bg-[color:var(--brand-primary)]"
                  />
                  <div className="flex shrink-0 items-center gap-1">
                    <ConversationTranscript key={active} channelId={active} />
                    <div className="flex shrink-0 items-center gap-1" role="tablist" aria-label="Conversation tools">
                      {([{ id: "conversation", label: "History", icon: MessageSquare }, { id: "shared", label: "Files", icon: Folder },
                        { id: "notes", label: "Notes", icon: StickyNote }, { id: "receipts", label: "Receipts", icon: ReceiptText }]).map(({ id, label, icon: Icon }) => (
                        <button key={id} type="button" role="tab" aria-label={label} title={label} aria-selected={tab === id}
                          className="hub-conversation-tool" onClick={() => {
                            setChooserOpen(false);
                            setCreateOpen(false);
                            setTab((current) => current === id ? "conversation" : id);
                          }}>
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        {controlsExpanded && chooserOpen && (
        <section role="region" aria-label="Conversation chooser" className="hub-conversation-chooser-card">
        <div className="hub-conversation-chooser-scroll">
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
          <NotificationTree />
          <details open className="hub-conversation-category">
            <summary>
              <Vote className="h-4 w-4 text-[color:var(--brand-primary)]" aria-hidden="true" />
              Polls
              <span>{visiblePolls.length}</span>
            </summary>
            {visiblePolls.length === 0 && (
              <p className="pb-3 text-xs text-muted-foreground">No polls in this view.</p>
            )}
            {visiblePolls.map((poll) => (
              <div
                key={poll.campaignId}
                data-selected={selectedPollId === poll.campaignId}
                className="hub-chat-conversation flex items-center rounded-lg"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 p-3 text-left"
                  onClick={() => selectPoll(poll.campaignId)}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <Vote className="h-4 w-4" aria-label="Poll" />
                    {poll.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {poll.completed
                      ? "Response saved"
                      : poll.state.status === "draft"
                        ? "Draft"
                        : poll.state.deadline
                          ? `Closes ${new Date(poll.state.deadline).toLocaleString()}`
                          : poll.state.status}
                  </span>
                </button>
              </div>
            ))}
          </details>
          {(["Channels", "Chats"] as const).map(category => {
            const entries = visible?.filter(c => conversationCategory(c) === category) ?? [];
            const Icon = category === "Chats" ? MessageSquare : Hash;
            return <details key={category} open className="hub-conversation-category">
              <summary><Icon className="h-4 w-4 text-[color:var(--brand-primary)]" aria-hidden="true" />{category}<span>{entries.length}</span></summary>
              {entries.length === 0 && <p className="pb-3 text-xs text-muted-foreground">No {category.toLowerCase()} in this view.</p>}
              {entries.map((c) => (
            <div
              key={c.id}
              data-selected={!selectedPollId && active === c.id}
              className="hub-chat-conversation flex items-center rounded-lg"
            >
              <button
                className="min-w-0 flex-1 p-3 text-left"
                onClick={() => selectConversation(c.id)}
              >
                <span className="flex items-center gap-2 font-medium">
                  <Icon className="h-4 w-4" aria-label={category === "Chats" ? "Chat" : "Channel"} />
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
            </details>;
          })}
        </nav>
        {!visible?.length && !visiblePolls.length && !channels.isLoading && (
          <p className="text-sm text-muted-foreground">
            No conversations match this view.
          </p>
        )}
        </div>
        </section>
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
        {controlsExpanded && createOpen && (
        <section
          role="region"
          aria-label="Create a channel, chat, or poll"
          className={`hub-create-panel ${WORK_HUB_SUBCARD_CLASS}`}
        >
          <p className="px-3 pt-3 text-sm font-semibold">Create New</p>
          <div className="grid grid-cols-3 gap-1 px-3 pb-3 pt-2" role="tablist" aria-label="Create new">
            {(["channel", "chat", "poll"] as const).map((kind) => {
              const disabled = kind === "channel" && !canCreateChannels;
              return (
                <button
                  key={kind}
                  type="button"
                  role="tab"
                  disabled={disabled}
                  aria-selected={createPanel === kind}
                  className="hub-create-tab"
                  title={disabled ? "Only an administrator or office user can create channels" : undefined}
                  onClick={() => setCreatePanel(kind)}
                >
                  {kind[0].toUpperCase() + kind.slice(1)}
                </button>
              );
            })}
          </div>
          <div
            role="tabpanel"
            aria-label={`New ${createPanel}`}
            className="hub-create-content mx-3 mb-3 grid gap-3 rounded-xl p-3"
          >
            {createPanel === "channel" && canCreateChannels && (
              <NewChannel onCreated={selectConversation} />
            )}
            {createPanel === "chat" && (
              <NewChat onCreated={selectConversation} />
            )}
            {createPanel === "poll" && (
              <NewPoll
                onCreated={(id) => {
                  selectPoll(id);
                  void pollCampaigns.query.refetch();
                }}
              />
            )}
            {createPanel === "chat" && invitations.data
              ?.filter(
                (invitation) =>
                  invitation.status === "pending" &&
                  invitation.recipientUserId === user?.userId,
              )
              .map((invitation) => (
                <div key={invitation.id} className="rounded border p-2 text-sm">
                  Chat invitation from {invitation.senderName ?? `user ${invitation.senderUserId}`}
                  <div className="mt-2 flex gap-2">
                    {[true, false].map((accept) => (
                      <BrandPillButton
                        key={String(accept)}
                        tone={accept ? "green" : "red"}
                        onClick={() =>
                          mutation.mutate({
                            path: `/invitations/${invitation.id}/respond`,
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
          </div>
        </section>
        )}
        <HubError error={mutation.error ?? save.error} />
      <main
        aria-label="Selected conversation workspace"
        className="grid min-w-0 content-start gap-4"
        style={{ paddingTop: "40px" }}
      >
        {selectedPollId ? (
          selectedPoll ? (
            <PollWorkspace poll={selectedPoll} />
          ) : (
            <section className={`p-6 ${WORK_HUB_CARD_CLASS}`}>
              <p role="status">Loading poll…</p>
            </section>
          )
        ) : active ? (
          <div className={`hub-communications-window ${WORK_HUB_CARD_CLASS}`} style={{ borderWidth: 0 }}>
            <section
              aria-label="Selected channel"
              data-work-hub-card
              className={`flex w-full flex-col items-stretch gap-2 px-4 py-3 ${WORK_HUB_CARD_CLASS}`}
            >
              {channel ? <ConversationTitle key={active} channel={{ id: channel.id, name: channel.name, version: channel.version }} canRename={channel.contextKind === "chat" ? (channel.createdById === user?.userId || canAdministerChannels) : canAdministerChannels} /> : <h2>Conversation</h2>}
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
                      <article key={m.id} data-message-tone={m.authorUserId === user?.userId ? "self" : m.authorIsAdmin ? "admin" : "other"} className="hub-chat-message flex gap-3">
                        <div className="hub-chat-bubble min-w-0">
                          <header className="mb-2 flex items-center gap-2">
                            <div className="hub-chat-avatar flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-semibold">
                              {String(m.authorName ?? m.authorUserId).slice(0, 2)}
                            </div>
                            <div className="min-w-0">
                              <p className="break-words text-sm font-semibold">{m.authorName ?? `User ${m.authorUserId}`}</p>
                              <time dateTime={m.createdAt} className="block text-xs font-normal text-muted-foreground">
                                {new Date(m.createdAt).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" })}{" "}
                                {new Date(m.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
                                {m.editedAt ? " · Edited" : ""}
                              </time>
                            </div>
                          {!m.deletedAt && (
                            <div className="ml-auto -mt-1 flex shrink-0 self-start items-center gap-0.5 text-xs text-muted-foreground">

                              {m.authorUserId === user?.userId && (
                                <button type="button" className="hub-message-action" title="Edit" aria-label="Edit"
                                  onClick={() => {
                                    setEditing(m);
                                    setDrafts((d) => ({
                                      ...d,
                                      [active]: m.body,
                                    }));
                                  }}
                                ><Pencil className="h-4 w-4" aria-hidden="true" /></button>
                              )}
                              {(m.authorUserId === user?.userId || canModerateMessages) && (
                                <button type="button" className="hub-message-action" title="Delete" aria-label="Delete"
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
                                ><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                              )}
                            </div>
                          )}
                          </header>
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                            {m.deletedAt
                              ? "Message deleted"
                              : <NoteMessage body={displayMentionText(m.body, members.data ?? [])} />}
                          </p>
                          {!m.deletedAt && channel && (
                            <div className="mt-2 flex flex-wrap items-center justify-end gap-1 text-xs text-muted-foreground">
                              <button type="button" className="hub-message-action" title="Reply in thread" aria-label="Reply in thread"
                                onClick={() =>
                                  setThread(m.rootMessageId ?? m.id)
                                }
                              ><Reply className="h-4 w-4" aria-hidden="true" /></button>
                              {channel && <MessageReactions channel={channel} message={m} onSaved={() => qc.invalidateQueries({ queryKey: ["work-hub"] })} />}
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
                    className={`grid w-full gap-3 p-4 ${WORK_HUB_CARD_CLASS}`}
                    style={{ paddingTop: 0, paddingBottom: "9.6px" }}
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
                    <div className="hub-inline-composer flex min-w-0 items-center gap-0 rounded-xl border-2 border-[color:var(--brand-primary)] px-0.5">
                      <ConversationAttachments key={active} onSelect={file => { setAttachment({ channelId: active, file }); setTab("shared"); }} />
                    <Textarea
                      className="min-w-0 flex-1"
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
                      <button
                        className="hub-conversation-tool disabled:cursor-not-allowed disabled:opacity-40"
                        type="submit"
                        aria-label={editing ? "Save edit" : "Send message"}
                        title={editing ? "Save edit" : "Send message"}
                        disabled={!body.trim() || mutation.isPending}
                      >
                        {editing ? <Check className="h-5 w-5" aria-hidden="true" /> : <ChevronRight className="h-5 w-5" aria-hidden="true" />}
                      </button>
                    </div>
                  </form>
                </>
              )}
              {tab === "receipts" && channelOwner && <div role="region" aria-label="Channel content" className="w-full space-y-3 p-4 md:p-6">
                <ReceiptEditor key={active} channelId={active} owner={channelOwner} initialReceiptId={linkedChannelId === active ? linkedReceiptId : null} onCancel={() => setTab("conversation")} />
              </div>}
              {tab === "notes" && (
                <div
                  role="region"
                  aria-label="Channel content"
                  data-work-hub-card
                  className={`grid w-full min-h-[18rem] gap-4 p-4 md:p-6 ${WORK_HUB_CARD_CLASS}`}
                >
                  {channelOwner && <NoteEditor key={active} channelId={active} owner={channelOwner} legacyNotes={notes.data?.map(n => ({ id: String(n.id), title: String(n.title ?? ""), body: String(n.body ?? "") }))} />}
                </div>
              )}
              {tab === "shared" && (
                <div
                  role="region"
                  aria-label="Channel content"
                  data-work-hub-card
                  className={`w-full min-h-[18rem] space-y-4 p-4 md:p-6 ${WORK_HUB_CARD_CLASS}`}
                >
                  <WorkHubFiles key={active} fixedChannelId={active} initialFile={attachment && attachment.channelId === active ? attachment.file : undefined} onInitialFileConsumed={() => setAttachment(null)} />
                </div>
              )}
              {tab === "people" && (
                <div
                  role="region"
                  aria-label="Channel content"
                  data-work-hub-card
                  className={`w-full min-h-[18rem] divide-y p-4 md:p-6 ${WORK_HUB_CARD_CLASS}`}
                >
                  {channel?.contextKind === "chat" ? <ChatParticipants key={active} channelId={active} creatorId={channel.createdById} members={(members.data ?? []).map(m => ({ userId: m.userId, displayName: m.displayName, mode: m.mode }))} /> : members.data?.map((m) => (
                    <div key={m.userId ?? m.id} className="py-3">
                      <strong>{m.displayName}</strong>
                      <p className="text-sm text-muted-foreground">
                        {m.email} · {m.mode ?? "Member"}
                      </p>
                    </div>
                  ))}
                  <HubError error={members.error} />
                  {channel?.contextKind !== "chat" && canAdministerChannels && (
                    <div className="space-y-4 pt-4">
                    <details>
                      <summary className="cursor-pointer text-sm font-semibold">Manage groups</summary>
                      <CollaborationWorkspace />
                    </details>
                    <details>
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
                          Company administrators manage
                          participants. Shared invitations require acceptance.
                        </p>
                      </div>
                    </details>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
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
      </aside>
      </div>
    </section>
  );
}
