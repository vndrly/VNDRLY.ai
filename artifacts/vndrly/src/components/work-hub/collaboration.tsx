import { MeetingsTree } from "./meetings-tree";
import { CommsUnreadIcon, useCommsSeen } from "./comms-unread-icon";
import { NeedsAttention, type AttentionItem } from "./needs-attention";
import { useAccounts, useInboxCounts, useConnectorScope } from "./connector-client";
import { ConnectedWorkspace, ConnectorTree } from "./connected-workspace";
import type { Selection as ConnectedSelection } from "./connector-client";
import { CardHeading } from "@/components/ui/card-heading";
import { CommunicationConnections } from "./communication-connections";
import { NoteEditor } from "./note-editor";
import { NoteMessage } from "./note-message";
import { ReceiptEditor } from "./receipt-editor";
import { ConversationTitle } from "./conversation-title";
import { ConversationAttachments } from "./conversation-attachments";
import { ConversationTranscript } from "./conversation-transcript";
import { NotificationTree } from "./notification-tree";
import { notificationsApi } from "@/lib/notifications-api";
import { NewChat } from "./new-chat";
import { WorkHubCalls } from "./calls";
import { NewChannel } from "./new-channel";
import { NewPoll, PollWorkspace, usePollCampaigns } from "./polls";
import { WorkHubFiles } from "./files";
import { ChatParticipants } from "./chat-participants";
import { MessageReactions } from "./message-reactions";
import "./collaboration.css";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearch, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Maximize2, Minimize2, Mail, CalendarDays, Home, MessageSquare, Hash, Star, Search, Users, Folder, StickyNote, ReceiptText, Trash2, ChevronRight, Check, Reply, Pencil, Vote, Plus, Layers3, BellRing, PanelLeftClose, PanelLeftOpen } from "lucide-react";
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

import { ProfileActionButton } from "@/components/gate-profile-chrome";
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
export function conversationUnreadTotals(channels: Row[], polls: Row[], notifications: Row[], now = Date.now(), additional: { calls?: number; emails?: number; polls?: number } = {}) {
  const unique = [...new Map(channels.map(channel => [channel.id, channel])).values()];
  const unread = (category: string) => unique.filter(channel => conversationCategory(channel) === category).reduce((sum, channel) => sum + Math.max(0, Number(channel.unreadCount) || 0), 0);
  const counts = {
    Channels: unread("Channels"), Chats: unread("Chats"),
    Polls: polls.filter(poll => poll.instanceId && !poll.completed && poll.state.status === "published" && (!poll.state.deadline || Date.parse(poll.state.deadline) > now)).length,
    Notifications: notifications.filter(notification => !notification.isRead).length,
  };
  return { ...counts, total: counts.Channels + counts.Chats + (additional.polls ?? counts.Polls) + counts.Notifications + (additional.calls ?? 0) + (additional.emails ?? 0) };
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
function useRows(path: string, enabled = true, refetchInterval = 15_000) {
  const { user } = useAuth();
  return useQuery<Row[]>({
    queryKey: ["work-hub", path, user?.userId, user?.activeMembershipId],
    queryFn: () => workHubRequest(path),
    enabled,
    refetchInterval,
  });
}

const personRoleLabels: Record<string, string> = {
  admin: "Administrative Team Member",
  member: "Staff",
  office: "Staff",
  ap: "Accounts Payable",
  field_employee: "Field Employee",
  foreman: "Foreman",
  gatekeeper: "Gatekeeper",
  gate_supervisor: "Gate Supervisor",
  managed_company_manager: "Company Manager",
  asset_manager: "Asset Manager",
  safety_manager: "Safety Manager",
};

export type DirectoryPerson = {
  id: number;
  displayName: string;
  organizationName?: string;
  role?: string;
  operationalRole?: string;
  sameCompany?: boolean;
};

export function directoryRoleLabel(
  person: Omit<DirectoryPerson, "id" | "displayName">,
  sameCompanyFieldEmployeeLabel = personRoleLabels.field_employee,
) {
  const role = person.operationalRole ?? person.role;
  if (!role) return undefined;
  return person.sameCompany && role === "field_employee"
    ? sameCompanyFieldEmployeeLabel
    : personRoleLabels[role];
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
        {people.data?.map(person => (
          <option key={person.id} value={person.id}>
            {[person.displayName, person.organizationName, directoryRoleLabel(person)].filter(Boolean).join(" · ")}
          </option>
        ))}
      </BrandedSelect>
      <HubError error={people.error} />
    </div>
  );
}

export { WorkHubHome as ActivityWorkspace } from "./home";

export function CollaborationWorkspace({ chat = false, callsList, meetingsPanel }: { chat?: boolean; callsList?: ReactNode; meetingsPanel?: ReactNode }) {
  const [,navigateAttention]=useLocation();
  const [attentionNotification,setAttentionNotification]=useState<number | undefined>();
  function openAttention(item:AttentionItem){
    if(item.kind==="conversation"){selectConversation(String(item.source.id));return;}
    if(item.kind==="poll"){selectPoll(item.source.campaignId);return;}
    setConnectedActive(false);setChooserOpen(false);setCreateOpen(false);setPollsActive(false);setSelectedPollId("");
    setCallsActive(item.kind==="call"||item.kind==="voicemail");setMeetingsActive(item.kind==="meeting");setNotificationsActive(item.kind==="notification");
    if(item.kind==="notification")setAttentionNotification(item.source.id);
    else navigateAttention(`/work-hub/chat?view=${item.kind==="meeting"?"meetings":"calls"}&${item.kind==="meeting"?"meeting":item.kind==="voicemail"?"voicemailId":"callId"}=${encodeURIComponent(item.source.id)}`);
  }
  const [callsActive, setCallsActive] = useState(() => new URLSearchParams(window.location.search).get("view") === "calls");
  const [meetingsActive, setMeetingsActive] = useState(() => new URLSearchParams(window.location.search).get("view") === "meetings");
  const [pollsActive, setPollsActive] = useState(false);
  const [notificationsActive, setNotificationsActive] = useState(false);
  const connectorScope = useConnectorScope();
  useEffect(() => { setConnectedActive(false); setConnectedSelection(null); }, [connectorScope]);
  const [connectedActive, setConnectedActive] = useState(false);
  const [connectedSelection, setConnectedSelection] = useState<ConnectedSelection | null>(null);
  function selectConnected(value: ConnectedSelection | null) { setConnectedSelection(value); setConnectedActive(true); setChooserOpen(false); setCallsActive(false); setMeetingsActive(false); setPollsActive(false); setNotificationsActive(false); setCreateOpen(false); }
  const [workspaceCategory, setWorkspaceCategory] = useState<"Channels" | "Chats">("Chats");
  const [sidebarVisible, setSidebarVisible] = useState({ Channels: true, Chats: true });
  const categoryList = useRef<HTMLElement | null>(null);
  const [categoryRequest, setCategoryRequest] = useState<{ name: string } | null>(null);
  useEffect(() => {
    if (!categoryRequest || !categoryList.current) return;
    const entries = categoryList.current.querySelectorAll<HTMLDetailsElement>(":scope > details, :scope > div > details");
    for (const entry of entries) {
      const label = Array.from(entry.querySelector(":scope > summary")?.childNodes ?? []).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join("").trim();
      entry.open = label.startsWith(categoryRequest.name);
    }
  }, [categoryRequest]);
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
  useEffect(() => {
    if (new URLSearchParams(searchParams).get("view") !== "meetings") return;
    setMeetingsActive(true); setCallsActive(false); setPollsActive(false); setNotificationsActive(false); setCreateOpen(false); setChooserOpen(false);
  }, [searchParams]);
  const linkedChannelId = new URLSearchParams(searchParams).get("channel");
  const linkedChannels = useRows("/channels?limit=100", chat && !!linkedChannelId);
  useEffect(() => {
    if (linkedChannelId) setSelected(linkedChannelId);
    else { setSelected(""); setChooserOpen(true); }
  }, [linkedChannelId]);
  const [crew, setCrew] = useState("");
  const [crewEditor, setCrewEditor] = useState<Row | null>(null);
  const [crewName, setCrewName] = useState("");
  const [channelName, setChannelName] = useState("");
  const [memberRole, setMemberRole] = useState("member");
  const crewChannels = useRows(`/crews/${crew}/channels`, false);
  const [search, setSearch] = useState("");
  const [overviewSearchOpen, setOverviewSearchOpen] = useState(false);
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
  const [createPanel, setCreatePanel] = useState<"channel" | "chat" | "poll" | "call">("chat");
  const [createOpen, setCreateOpen] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(!linkedChannelId);
  const [controlsExpanded, setControlsExpanded] = useState(true);
  const [commsExpanded, setCommsExpanded] = useState(false);
  useEffect(() => {
    if (!commsExpanded) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setCommsExpanded(false); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [commsExpanded]);
  const [selectedPollId, setSelectedPollId] = useState("");
  const pollCampaigns = usePollCampaigns();
  const notifications = useQuery({ queryKey: ["notifications", "list", user?.userId], queryFn: () => notificationsApi.list(), enabled: chat && !!user, refetchInterval: 15_000, retry: false });
  const pollSeen = useCommsSeen(String(user?.userId), "polls");
  const [callUnread, setCallUnread] = useState(0);
  const connectedAccounts = useAccounts();
  const inboxCounts = useInboxCounts(connectedAccounts.data?.accounts ?? []);
  const pollUnread = (pollCampaigns.polls ?? []).filter(p => p.instanceId && !pollSeen.seen.includes(p.campaignId)).length;
  const unreadCounts = conversationUnreadTotals(channels.data ?? [], pollCampaigns.polls ?? [], notifications.data ?? [], Date.now(), { calls: callUnread, emails: inboxCounts.unread, polls: pollUnread });
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
  const messages = useRows(`/channels/${active}/messages`, !!active, 5_000);
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
    setConnectedActive(false);
    setPollsActive(false); setNotificationsActive(false);
    const selectedConversation = list?.find(c => c.id === channelId);
    if (selectedConversation) setWorkspaceCategory(conversationCategory(selectedConversation));
    setConnectedActive(false); setCallsActive(false); setMeetingsActive(false);
    setTab("conversation");
    setSelected(channelId);
    setSelectedPollId("");
    setChooserOpen(false);
    setCreateOpen(false);
    save.mutate({ lastConversationId: channelId });
  }
  function selectPoll(campaignId: string) {
    pollSeen.markSeen(campaignId);
    setConnectedActive(false); setCallsActive(false); setMeetingsActive(false);
    setPollsActive(true); setNotificationsActive(false);
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
      <section className="hub-chat-page hub-groups-page w-full space-y-4 p-4" data-testid="work-hub-channels">
        <WorkHubPageHeading
          module="channels"
          title="Groups"
          backFallbackHref="/"
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
              <ProfileActionButton
                disabled={!name.trim() || !owner || mutation.isPending}
                onClick={() =>
                  mutation
                    .mutateAsync({ path: "/crews", data: { owner, name } })
                    .then(() => setName(""))
                    .catch(() => undefined)
                }
              >
                Create Group
              </ProfileActionButton>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {crews.data?.map((item) => (
              <ProfileActionButton
                key={item.id}
                type="button"
                aria-label={`Edit ${item.name}`}
                className="hub-group-card justify-start text-left text-sm"
                onClick={() => {
                  setCrew(item.id);
                  setCrewEditor(item);
                  setCrewName(item.name);
                }}
              >
                {item.name}
              </ProfileActionButton>
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
              className="hub-groups-dialog max-h-[86vh] sm:max-w-2xl"
            >
              <section className="grid gap-3 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4">
                <label className="text-sm font-semibold" htmlFor="group-name">Group name</label>
                <BrandedInput
                  id="group-name"
                  aria-label="Group name"
                  value={crewName}
                  onChange={(event) => setCrewName(event.target.value)}
                />
                <ProfileActionButton
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
                </ProfileActionButton>
              </section>
              <section data-card-layout className="grid gap-3 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4">
                <CardHeading as="h3" className="font-semibold">Members and owners</CardHeading>
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
                    <ProfileActionButton
                      className="hub-group-destructive"
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
                    </ProfileActionButton>
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
                <ProfileActionButton
                  disabled={!person || mutation.isPending}
                  onClick={() =>
                    mutation.mutate({
                      path: `/crews/${crewEditor.id}/members`,
                      data: { userId: Number(person), mode: memberRole },
                    })
                  }
                >
                  Add or update member
                </ProfileActionButton>
              </section>
              {isWorkHubAdmin(user) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <ProfileActionButton
                    disabled={mutation.isPending}
                    onClick={() =>
                      mutation
                        .mutateAsync({ path: `/crews/${crewEditor.id}/archive`, data: {} })
                        .then(() => { setCrewEditor(null); setCrew(""); })
                        .catch(() => undefined)
                    }
                  >
                    Archive group
                  </ProfileActionButton>
                  <ProfileActionButton
                    className="hub-group-destructive"
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
                  </ProfileActionButton>
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
      <WorkHubPageHeading module="chat" title="Communications" compact actions={<span className="hub-new-message-total" style={{ color: unreadCounts.total ? "#f87171" : "#b3b3b3" }} aria-live="polite"><MessageSquare aria-hidden="true" /><strong>{unreadCounts.total} New Messages</strong></span>} />
      <div className="hub-conversation-layout grid gap-4" data-controls-collapsed={!controlsExpanded}>
      <aside
        aria-label="Communications panel"
        data-fullscreen={commsExpanded}
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
              setControlsExpanded((expanded) => !expanded);
            }}
          >
            <SphereBackButton size={40} overlay={<Layers3 className="lucide-layers-3 h-5 w-5" />} />
          </button>
          {(
            <div
              role="toolbar"
              style={{ display: controlsExpanded ? undefined : "none" }}
              aria-label="Conversation controls drawer"
              aria-orientation="horizontal"
              className="hub-conversation-drawer flex min-w-0 flex-1 items-center gap-1"
            >
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" className="hub-conversation-tool hub-category-tool" aria-label="Home" title="Home"
                  onClick={() => {
                    setConnectedActive(false); setCallsActive(false); setMeetingsActive(false);
                    setPollsActive(false); setNotificationsActive(false);
                    setSelectedPollId("");
                    setSelected("");
                    setSearch("");
                    setCreateOpen(false);
                    setTab("conversation");
                    setChooserOpen(true);
                    setCategoryRequest({ name: "Home" });
                  }}>
                  <Home className="size-5" aria-hidden="true" />
                </button>
                <button type="button" className="hub-conversation-tool hub-category-tool" aria-label="Email" title="Email" onClick={() => selectConnected(null)}><Mail className="size-5" /></button>
                {([["Polls", Vote], ["Channels", Hash], ["Chats", MessageSquare], ["Meetings", CalendarDays], ["Notifications", BellRing]] as const).map(([name, Icon]) => (
                  <Fragment key={name}>
                  {chat && name === "Meetings" && <div id="conversation-calls-toolbar" className="flex items-center" />}
                  <button type="button" className="hub-conversation-tool hub-category-tool" aria-label={name} title={name}
                    onClick={() => {
                      setConnectedActive(false); setCallsActive(false); setMeetingsActive(false);
                      setMeetingsActive(name === "Meetings");
                      setPollsActive(name === "Polls");
                      setNotificationsActive(name === "Notifications");
                      setSelectedPollId("");
                      setChooserOpen(false);
                      if (name === "Chats" || name === "Channels") {
                        setWorkspaceCategory(name);
                        if (channel && conversationCategory(channel) !== name) setSelected("");
                      }
                      setCreateOpen(false);
                      setTab("conversation");
                      setCategoryRequest({ name });
                    }}>
                    <Icon className="size-5" aria-hidden="true" />
                  </button>
                  </Fragment>
                ))}
                <button
                  type="button"
                  className="hub-conversation-tool hub-category-tool"
                  aria-label="Create new"
                  title="Create new"
                  aria-expanded={createOpen}
                  onClick={() => {
                    setConnectedActive(false); setCallsActive(false); setMeetingsActive(false);
                    setCreateOpen((open) => !open);
                    setChooserOpen(false);
                    setTab("conversation");
                  }}
                >
                  <Plus className="size-5" aria-hidden="true" />
                </button>
                {chooserOpen && (
                  <button type="button" className="hub-conversation-tool hub-category-tool"
                    aria-label={overviewSearchOpen ? "Hide conversation search" : "Show conversation search"}
                    title={overviewSearchOpen ? "Hide search" : "Show search"}
                    aria-expanded={overviewSearchOpen} aria-controls="comms-overview-search"
                    onClick={() => { setOverviewSearchOpen(open => !open); if (overviewSearchOpen) setSearch(""); }}>
                    <Search className="size-5" aria-hidden="true" />
                  </button>
                )}                {!connectedActive && !chooserOpen && !meetingsActive && !pollsActive && !notificationsActive && !selectedPollId && !callsActive && !createOpen && (
                  <button type="button" className="hub-conversation-tool hub-category-tool"
                    aria-label={`${sidebarVisible[workspaceCategory] ? "Hide" : "Show"} ${workspaceCategory.toLowerCase()} list`}
                    title={`${sidebarVisible[workspaceCategory] ? "Hide" : "Show"} ${workspaceCategory.toLowerCase()} list`}
                    aria-expanded={sidebarVisible[workspaceCategory]}
                    onClick={() => setSidebarVisible(current => ({ ...current, [workspaceCategory]: !current[workspaceCategory] }))}>
                    {sidebarVisible[workspaceCategory] ? <PanelLeftClose className="size-5" aria-hidden="true" /> : <PanelLeftOpen className="size-5" aria-hidden="true" />}
                  </button>
                )}
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
          <button type="button" className="hub-conversation-tool ml-auto shrink-0" aria-label={commsExpanded ? "Exit full screen" : "Expand Communications to full screen"} title={commsExpanded ? "Exit full screen" : "Expand Communications to full screen"} aria-pressed={commsExpanded} onClick={() => setCommsExpanded(value => !value)}>
            {commsExpanded ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />}
          </button>
        </div>
        {!chat && (
          <>
            <section data-card-layout
              role="region"
              aria-label="Manage crews and channels"
              className="grid gap-3 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-3"
            >
              <CardHeading as="h2" className="text-sm font-semibold">Manage Crews & channels</CardHeading>
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
                <ProfileActionButton
                  color="blue"
                  disabled={!name.trim() || !owner || mutation.isPending}
                  onClick={() =>
                    mutation
                      .mutateAsync({ path: "/crews", data: { owner, name } })
                      .then(() => setName(""))
                      .catch(() => undefined)
                  }
                >
                  Create Crew
                </ProfileActionButton>
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
                    <ProfileActionButton
                      color="blue"
                      disabled={!crewName.trim() || mutation.isPending}
                      onClick={() => mutation.mutateAsync({ path: `/crews/${crewEditor.id}`, method: "PATCH", data: { name: crewName } }).then(() => setCrewEditor({ ...crewEditor, name: crewName })).catch(() => undefined)}
                    >
                      Save crew name
                    </ProfileActionButton>
                  </section>

                  <section data-card-layout className="grid gap-3 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4">
                    <CardHeading as="h3" className="font-semibold">Channels</CardHeading>
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
                    <ProfileActionButton color="blue" disabled={!channelName.trim() || mutation.isPending} onClick={() => mutation.mutateAsync({ path: `/crews/${crewEditor.id}/channels`, data: { name: channelName, visibility } }).then(() => setChannelName("")).catch(() => undefined)}>Add channel</ProfileActionButton>
                      </>
                    )}
                  </section>

                  <section data-card-layout className="grid gap-3 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4">
                    <CardHeading as="h3" className="font-semibold">Members and roles</CardHeading>
                    {crewMembers.data?.map((member) => (
                      <div key={member.userId} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_150px] sm:items-center">
                        <span className="text-sm">{member.displayName}</span>
                        <BrandedSelect aria-label={`Role for ${member.displayName}`} value={member.mode} onChange={(event) => mutation.mutate({ path: `/crews/${crewEditor.id}/members`, data: { userId: Number(member.userId), mode: event.target.value } })}>
                          <option value="member">Member</option>
                          <option value="owner">Owner</option>
                        </BrandedSelect>
                        <ProfileActionButton
                          color="red"
                          aria-label={`Remove ${member.displayName}`}
                          disabled={mutation.isPending}
                          onClick={() => mutation.mutate({ path: `/crews/${crewEditor.id}/members/${member.userId}`, method: "DELETE", data: {} })}
                        >
                          Remove member
                        </ProfileActionButton>
                      </div>
                    ))}
                    <PeoplePicker value={person} onChange={setPerson} />
                    <BrandedSelect aria-label="New member role" value={memberRole} onChange={(event) => setMemberRole(event.target.value)}>
                      <option value="member">Member</option>
                      <option value="owner">Owner</option>
                    </BrandedSelect>
                    <ProfileActionButton color="blue" disabled={!person || mutation.isPending} onClick={() => mutation.mutate({ path: `/crews/${crewEditor.id}/members`, data: { userId: Number(person), mode: memberRole } })}>Add or update member</ProfileActionButton>
                  </section>

                  {isWorkHubAdmin(user) && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <ProfileActionButton color="brand" disabled={mutation.isPending} onClick={() => mutation.mutateAsync({ path: `/crews/${crewEditor.id}/archive`, data: {} }).then(() => { setCrewEditor(null); setCrew(""); }).catch(() => undefined)}>Archive crew</ProfileActionButton>
                      <ProfileActionButton color="red" disabled={mutation.isPending} onClick={() => { if (window.confirm("Delete this crew? It will be removed from active crew lists. Its audit history will be retained.")) mutation.mutateAsync({ path: `/crews/${crewEditor.id}`, method: "DELETE", data: {} }).then(() => { setCrewEditor(null); setCrew(""); }).catch(() => undefined); }}>Delete crew</ProfileActionButton>
                    </div>
                  )}
                  <HubError error={mutation.error} />
                </MiniCardDialogContent>
              )}
            </Dialog>
          </>
        )}
        {createOpen && (
        <section
          role="region"
          aria-label="Create a channel, chat, or poll"
          className={`hub-create-panel ${WORK_HUB_SUBCARD_CLASS}`}
        >
          <div className="flex items-center justify-between px-3 pt-3">
            <p className="text-sm font-semibold">Create New</p>
          </div>
          <div className="grid grid-cols-4 gap-1 px-3 pb-3 pt-2" role="tablist" aria-label="Create new">
            {(["poll", "channel", "chat", "call"] as const).map((kind) => {
              const disabled = kind === "channel" && !canCreateChannels;
              return (
                <ProfileActionButton
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
                </ProfileActionButton>
              );
            })}
          </div>
          <div
            role="tabpanel"
            aria-label={`New ${createPanel}`}
            className="hub-create-content mx-3 mb-3 grid gap-3 rounded-xl p-3"
          >
            {createPanel === "call" && <WorkHubCalls embedded dialOnly />}
            {createPanel === "channel" && canCreateChannels && (
              <NewChannel onCreated={id => { setWorkspaceCategory("Channels"); selectConversation(id); }} onCancel={() => {
                setCreateOpen(false);
                setChooserOpen(true);
                setTab("conversation");
              }} />
            )}
            {createPanel === "chat" && (
              <NewChat onCreated={id => { setWorkspaceCategory("Chats"); selectConversation(id); }} onCancel={() => {
                setCreateOpen(false);
                setChooserOpen(true);
                setTab("conversation");
              }} />
            )}
            {createPanel === "poll" && (
              <NewPoll
                onCancel={() => { setCreateOpen(false); setChooserOpen(true); }}
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
                      <ProfileActionButton
                        key={String(accept)}
                        color={accept ? "green" : "red"}
                        onClick={() =>
                          mutation.mutate({
                            path: `/invitations/${invitation.id}/respond`,
                            data: { accept },
                          })
                        }
                      >
                        {accept ? "Accept" : "Decline"}
                      </ProfileActionButton>
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
        className="hub-selected-workspace grid min-w-0 content-start gap-4"
        data-chat-split={!connectedActive && !chooserOpen && !meetingsActive && !pollsActive && !notificationsActive && !selectedPollId && !callsActive && sidebarVisible[workspaceCategory]}
        style={{ visibility: createOpen ? "hidden" : undefined }}
      >
        {!connectedActive && !chooserOpen && !meetingsActive && !pollsActive && !notificationsActive && !selectedPollId && !callsActive && sidebarVisible[workspaceCategory] && <nav aria-label={workspaceCategory === "Channels" ? "Channel list" : "Chat list"} className="hub-chat-sidebar">
          <h2 className="mb-3">{workspaceCategory}</h2>
          <ConnectorTree kind={workspaceCategory === "Chats" ? "chats" : "channels"} onSelect={selectConnected} />
          <BrandedInput aria-label={`Search ${workspaceCategory.toLowerCase()}`} placeholder={`Search ${workspaceCategory.toLowerCase()}`} value={search} onChange={event => setSearch(event.target.value)} />
          {visible?.filter(c => conversationCategory(c) === workspaceCategory).map(c => <button key={c.id} type="button" className="hub-chat-conversation w-full p-3 text-left text-sm" data-selected={active === c.id} onClick={() => selectConversation(c.id)}>{c.name}</button>)}
          {!visible?.some(c => conversationCategory(c) === workspaceCategory) && <p className="py-3 text-sm text-muted-foreground">No {workspaceCategory.toLowerCase()} in this view.</p>}
        </nav>}
        <div className="hub-conversation-active min-h-0 min-w-0" style={{ display: callsActive || meetingsActive ? "none" : undefined }}>
        {connectedActive ? <ConnectedWorkspace selection={connectedSelection} onSelect={selectConnected} onBack={() => selectConnected(null)} /> : notificationsActive && !chooserOpen ? (
          <section aria-label="Notifications panel" className="relative h-full min-h-0 overflow-y-auto p-3">
            <NotificationTree standalone initialSelectedId={attentionNotification} />
          </section>
        ) : pollsActive && !chooserOpen && !selectedPollId ? (
          <section aria-label="Polls panel" className="hub-poll-workspace space-y-4 p-3">
            <h2>Polls</h2>
            <BrandedInput aria-label="Search polls" placeholder="Search polls" value={search} onChange={event => setSearch(event.target.value)} />
            {pollCampaigns.polls === undefined && <p role="status">Loading polls…</p>}
            {pollCampaigns.polls !== undefined && visiblePolls.length === 0 && <p className="text-muted-foreground">No polls in this view.</p>}
            {visiblePolls.map(poll => (
              <button key={poll.campaignId} type="button" className="hub-chat-conversation flex w-full items-center gap-2 border-b p-3 text-left" onClick={() => selectPoll(poll.campaignId)}>
                <Vote className="size-5 shrink-0 text-[var(--brand-primary)]" aria-hidden="true" />
                <span className="min-w-0 flex-1"><strong>{poll.title}</strong><span className="block text-xs text-muted-foreground">{poll.completed ? "Response saved" : poll.state.status}</span></span>
                <ChevronRight className="size-4" aria-hidden="true" />
              </button>
            ))}
          </section>
        ) : chooserOpen ? (
          <section aria-label="Channel content" data-work-hub-card className={`hub-conversation-browser-frame ${WORK_HUB_CARD_CLASS}`}>
        <section role="region" aria-label="Conversation chooser" className="hub-conversation-chooser-card">
          <div className="hub-conversation-chooser-scroll">
            {overviewSearchOpen && <div id="comms-overview-search" className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input className="rounded-lg border-2 border-[color:var(--brand-primary)] bg-white pl-9 shadow-none focus-visible:ring-[color:var(--brand-primary)]" aria-label="Find conversations" placeholder="Find a conversation" value={search} onChange={event => setSearch(event.target.value)} />
            </div>}
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
        <nav ref={categoryList} aria-label="Communications" className="space-y-1">
          <details className="hub-conversation-category">
            <summary>
              <CommsUnreadIcon count={pollUnread} label="polls"><Vote className="h-4 w-4 text-[color:var(--brand-primary)]" aria-hidden="true" /></CommsUnreadIcon>
              Polls
              <span aria-label="Total polls">{pollCampaigns.polls?.length ?? 0}</span>
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
            return <details key={category} className="hub-conversation-category">
              <summary><CommsUnreadIcon count={unreadCounts[category]} label={category.toLowerCase()+" messages"}><Icon className="h-4 w-4 text-[color:var(--brand-primary)]" aria-hidden="true" /></CommsUnreadIcon>{category}<span aria-label={`Total ${category.toLowerCase()}`}>{(channels.data ?? []).filter(c => conversationCategory(c) === category).length}</span></summary>
              <ConnectorTree kind={category === "Chats" ? "chats" : "channels"} onSelect={selectConnected} />
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
          {callsList}
          <MeetingsTree onOpen={id => openAttention({id:`meeting:${id}`,kind:"meeting",title:"",reason:"",score:0,time:0,source:{id}})} />
          <NotificationTree />
          <ConnectorTree kind="email" onSelect={selectConnected} />
        </nav>
        <NeedsAttention channels={channels.data ?? []} polls={pollCampaigns.polls ?? []} notifications={notifications.data ?? []} search={search} onOpen={openAttention} onEmail={selectConnected}/>
        </div>
        </section>

          </section>
        ) : selectedPollId ? (
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
                      <ProfileActionButton
                        color="blue"
                        onClick={() => setThread(null)}
                      >
                        Back to conversation
                      </ProfileActionButton>
                    </div>
                  )}
                  <div className="min-h-48 space-y-4">
                    {shownMessages.map((m) => (
                      <article key={m.id} data-message-tone={m.kind === "askv_answer" ? "other" : m.authorUserId === user?.userId ? "self" : m.authorIsAdmin ? "admin" : "other"} className="hub-chat-message flex gap-3">
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

                              {m.authorUserId === user?.userId && m.kind !== "askv_answer" && (
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
                            <ProfileActionButton
                              color="blue"
                              disabled={!person || mutation.isPending}
                              onClick={() =>
                                mutation.mutate({
                                  path: `/channels/${active}/invitations`,
                                  data: { recipientUserId: Number(person) },
                                })
                              }
                            >
                              Invite to shared channel
                            </ProfileActionButton>
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
                            <ProfileActionButton
                              color="blue"
                              disabled={!memberEmail || mutation.isPending}
                              onClick={() =>
                                mutation.mutate({
                                  path: `/channels/${active}/members`,
                                  data: { email: memberEmail },
                                })
                              }
                            >
                              Add channel participant
                            </ProfileActionButton>
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
        </div>
        {meetingsActive && <section aria-label="Meetings panel" className="min-h-0 overflow-y-auto p-3">{meetingsPanel}</section>}
        {chat && <div className="hub-calls-active current-theme-page current-theme-legacy" style={{ display: callsActive ? undefined : "none" }}>
          <WorkHubCalls embedded onUnreadChange={setCallUnread} toolbarTargetId="conversation-calls-toolbar" onActivate={() => { setConnectedActive(false); setMeetingsActive(false); setCallsActive(true); setCreateOpen(false); }} />
        </div>}
      </main>
      </aside>
      </div>
      {chat && <CommunicationConnections />}
    </section>
  );
}


