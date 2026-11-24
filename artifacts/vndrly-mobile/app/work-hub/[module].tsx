import ConnectedWorkspace, { ConnectorTree } from "@/components/work-hub/ConnectedWorkspace";
import { useAccounts, useConnectorScope, useInboxCounts, type Selection as ConnectedSelection } from "@/components/work-hub/connector-client";
import CommunicationConnections from "@/components/work-hub/CommunicationConnections";
import CalendarOverviewCards from "@/components/work-hub/CalendarOverviewCards";
import WorkHubAwaySettings from "@/components/work-hub/WorkHubAwaySettings";
import { ModalPressable as Pressable, ModalTextInput as TextInput } from "@/components/ModalDraft";
import { Ionicons } from "@expo/vector-icons";
import DismissibleModal from "@/components/DismissibleModal";
import NewConversation from "@/components/work-hub/NewConversation";
import ProfileMiniCardButton from "@/components/ProfileMiniCardButton";
import SafetyDashboardCard from "@/components/SafetyDashboardCard";
import { useFocusEffect } from "expo-router";
import AssignedCards from "@/components/work-hub/library/AssignedCards";
import FormCampaignList, { type FormCampaignSummary } from "@/components/work-hub/FormCampaignList";
import TaskAssignment from "@/components/work-hub/TaskAssignment";
import * as Crypto from "expo-crypto";
import { mobileCommandEnvelope } from "@/lib/work-hub-mobile";
import DailyWorkPanel from "@/components/DailyWorkPanel";
import UnifiedWorkCalendar from "@/components/UnifiedWorkCalendar";
import { parseGateStaffingCalendarParams } from "@/lib/gate-staffing-calendar";
import WorkHubAvailability from "@/components/WorkHubAvailability";
import { Stack, router, useLocalSearchParams, Redirect } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import WorkHubMeetings from "@/components/WorkHubMeetings";
import ShiftScheduling from "@/components/ShiftScheduling";
import WorkHubShiftOpening from "@/components/WorkHubShiftOpening";
import WorkHubCalls from "@/components/WorkHubCalls";
import { ManagedCrews } from "@/components/implementation-a/ManagedCrews";
import { FilesInventory } from "@/components/work-hub/FilesInventory";
import { NativeRepository } from "@/components/work-hub/NativeRepository";
import EquipmentWorkbench from "@/components/EquipmentWorkbench";
import {
  WorkHubSearch,
  type WorkHubSearchDestination,
} from "@/components/work-hub/WorkHubSearch";
import { RoleExports } from "@/components/work-hub/RoleExports";
import WorkHubConversation from "@/components/WorkHubConversation";
import WorkHubChatInbox from "@/components/WorkHubChatInbox";
import { useMeetingCompanion } from "@/components/MeetingCompanionProvider";
import TogglePillButton from "@/components/TogglePillButton";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import WorkHubShiftCalendar from "@/components/WorkHubShiftCalendar";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import {
  cacheAssignedRead,
  readAssignedCache,
} from "@/lib/native-assigned-cache";
import {
  pickMeetingFile,
  persistMeetingFileForOffline,
  uploadMeetingFile,
  type MeetingFileSource,
} from "@/lib/meeting-files";
import {
  loadFilesInventoryData,
  mobileOwner,
  moduleEndpoint,
} from "@/lib/work-hub-mobile";
import { isCoordinatedPlanDescription } from "@/lib/work-hub-plan";
import {
  flushNativeWorkHubQueue,
  isOfflineWorkHubFailure,
  queueNativeWorkHubRequest,
  queueNativeWorkHubUpload,
} from "@/lib/work-hub-queue-runtime";

type Row = Record<string, any>;
const titles: Record<string, string> = {
  channels: "Groups",
  activity: "Activity",
  "managed-crews": "Tasks & Crews",
  files: "File Library",
  assets: "Inventory",
  "implementation-exports": "Exports",
  chat: "Communications",
  "communication-channels": "Channels",
  crews: "Crews",
  calendar: "Calendar",
  "tasks-forms": "Tasks & Forms",
  meetings: "Meetings",
  calls: "Calls",
  search: "Search",
  "settings-connections": "Settings & Connections",
};
function envelope(
  owner: { type: "vendor" | "partner"; id: number },
  payload: unknown,
  expectedVersion?: number,
  context: { kind: "organization" | "gate"; id: number } = {
    kind: "organization",
    id: owner.id,
  },
) {
  return mobileCommandEnvelope(
    owner,
    payload,
    expectedVersion,
    context,
    Crypto.randomUUID(),
  );
}

export default function WorkHubModuleScreen() {
  const { module, ...params } = useLocalSearchParams<{ module?: string | string[] }>();
  const connectorScope = useConnectorScope();
  const name = Array.isArray(module) ? module[0] : module;
  if (name === "tasks-forms" || name === "tasks") return <Redirect href="/work-hub/managed-crews" />;
  if (name === "settings-connections" || name === "settings") return <Redirect href="/import-export" />;
  if (name === "administration") return <Redirect href="/work-hub" />;
  if (name === "operations-health") return <Redirect href="/work-hub" />;
  if (name === "coverage" || name === "workforce-coverage") return <Redirect href="/work-hub" />;
  if (name === "site-presence" || name === "safety-response") return <Redirect href="/work-hub" />;
  if (name === "calls" || name === "meetings") return <Redirect href={{ pathname: "/work-hub/[module]", params: { ...params, module: "chat", view: name } }} />;
  if (name === "channels") return <Redirect href={{ pathname: "/work-hub/[module]", params: { ...params, module: "chat", view: "channels" } }} />;
  if (name === "chat") return <CommunicationsWorkspace key={connectorScope} />;
  return <WorkHubModuleWorkspace />;
}

const NotificationsScreen = React.lazy(() => import("@/app/notifications"));
function CommunicationsWorkspace() {
  const colors = useColors();
  const { height } = useWindowDimensions();
  const { user, activeMembershipId } = useAuth();
  const { view, accountId } = useLocalSearchParams<{ view?: string; accountId?: string }>();
  const [section, setSection] = useState(view ?? "home");
  const [connectedSelection, setConnectedSelection] = useState<ConnectedSelection | null>(null);
  const openConnected = (value: ConnectedSelection) => { setConnectedSelection(value); setSection("connected"); };
  const [menuOpen, setMenuOpen] = useState(true);
  const [commsExpanded, setCommsExpanded] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  useEffect(() => { setSection(view ?? "home"); }, [view]);
  const identity = [user?.id, activeMembershipId, user?.vendorId, user?.partnerId];
  const channels = useQuery({ queryKey: ["work-hub", "channels", ...identity], queryFn: () => apiFetch<{ contextKind: string; contextId?: string; unreadCount?: number }[]>("/api/work-hub/channels"), enabled: !!user, refetchInterval: 15000 });
  const polls = useQuery({ queryKey: ["work-hub", "form-campaigns", ...identity], queryFn: () => apiFetch<{ campaigns: FormCampaignSummary[] }>("/api/work-hub/form-campaigns"), enabled: !!user, refetchInterval: 15000 });
  const calls = useQuery({ queryKey: ["work-hub", "calls", ...identity], queryFn: () => apiFetch<{ id: string }[]>("/api/work-hub/calls"), enabled: !!user, refetchInterval: 15000 });
  const voicemail = useQuery({ queryKey: ["work-hub", "voicemail", ...identity], queryFn: () => apiFetch<{ id: string; senderName: string; transcript: string | null; readAt: string | null }[]>("/api/work-hub/voicemail"), enabled: !!user, refetchInterval: 15000 });
  const meetings = useQuery({ queryKey: ["work-hub", "comms-meetings", ...identity], queryFn: () => apiFetch<{ meetings: { item: { occurrence: { id: string } } }[] }>("/api/work-hub/calendar?kind=meetings&start=1970-01-01T00:00:00.000Z&end=2100-01-01T00:00:00.000Z"), enabled: !!user, refetchInterval: 60000 });
  const notices = useQuery({ queryKey: ["work-hub", "home-notices", ...identity], queryFn: () => apiFetch<{ isRead?: boolean }[] | { items: { isRead?: boolean }[] }>("/api/notifications?limit=100"), enabled: !!user, refetchInterval: 30000 });
  const accounts = useAccounts();
  useEffect(() => {
    if (!accountId || view !== "connected") return;
    const account = accounts.data?.accounts.find(row => row.id === accountId && row.status === "connected" && ["gmail", "outlook"].includes(row.provider));
    if (account) { setConnectedSelection({ account, kind: "email" }); setSection("connected"); }
  }, [accountId, view, accounts.data]);
  const inbox = useInboxCounts(accounts.data?.accounts.filter(account => account.status === "connected" && ["gmail", "outlook"].includes(account.provider)) ?? []);
  const unreadVoicemail = voicemail.data?.filter(item => !item.readAt) ?? [];
  const noticeRows = notices.data ? Array.isArray(notices.data) ? notices.data : notices.data.items : [];
  const unreadMessages = (channels.data?.reduce((sum, row) => sum + (row.unreadCount ?? 0), 0) ?? 0) + unreadVoicemail.length + (inbox.total ?? 0);
  const choices = [["home", "Home", "home-outline"], ["email", "Email", "mail-outline"], ["polls", "Polls & policies", "stats-chart-outline"], ["channels", "Channels", "grid-outline"], ["chat", "Chats", "chatbubbles-outline"], ["calls", "Calls", "call-outline"], ["meetings", "Meetings", "calendar-outline"], ["notifications", "Notifications", "notifications-outline"], ["search", "Search", "search-outline"]] as const;
  const rows = [
    { id: "polls", label: "Polls & policies", icon: "checkbox-outline", count: polls.data?.campaigns.filter(row => row.kind === "poll" || row.kind === "acknowledgement").length },
    { id: "channels", label: "Channels", icon: "grid-outline", count: channels.data?.filter(row => row.contextKind !== "chat" || String(row.contextId ?? "").startsWith("group:")).length },
    { id: "chat", label: "Chats", icon: "chatbubble-outline", count: channels.data?.filter(row => row.contextKind === "chat" && !String(row.contextId ?? "").startsWith("group:")).length },
    { id: "calls", label: "Calls", icon: "call-outline", count: (calls.data?.length ?? 0) + (voicemail.data?.length ?? 0) },
    { id: "meetings", label: "Meetings", icon: "calendar-outline", count: meetings.data?.meetings.length },
    { id: "notifications", label: "Notifications", icon: "notifications-outline", count: notices.data ? noticeRows.length : undefined },
    { id: "email", label: "Emails", icon: "mail-outline", count: inbox.total },
  ] as const;
  const rowStyle = { minHeight: 48, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingHorizontal: 12 };
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
      <WorkHubPageTitle title="Communications" right={unreadMessages > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${unreadMessages} New Messages`}
          onPress={() => setSection((inbox.total ?? 0) > 0 ? "email" : unreadVoicemail.length > 0 ? "calls" : "channels")}
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, paddingVertical: 7, paddingHorizontal: 10, borderWidth: 1, borderRadius: 8, borderColor: colors.primary, backgroundColor: "#2b2b2f" }}
        >
          <Ionicons name="chatbox-outline" size={17} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>{unreadMessages} New Messages</Text>
        </Pressable>
      ) : undefined} />
    </View>
    <View style={commsExpanded ? { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 10, backgroundColor: colors.background } : { flex: 1 }}>
    <View style={{ marginHorizontal: commsExpanded ? 0 : 16, borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.card, borderRadius: commsExpanded ? 0 : 16, padding: 8, flex: commsExpanded || section !== "home" ? 1 : undefined }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={menuOpen ? "Hide menu" : "Show menu"} accessibilityState={{ expanded: menuOpen }} onPress={() => setMenuOpen(open => !open)} style={{ minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center" }}><Ionicons name="layers-outline" size={24} color={colors.primary} /></Pressable>
        {menuOpen && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ flexDirection: "row", gap: 4 }}>{choices.map(([id, label, icon]) => <Pressable key={id} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: section === id }} onPress={() => setSection(id)} style={{ minWidth: 40, minHeight: 44, alignItems: "center", justifyContent: "center" }}><Ionicons name={icon} size={22} color={section === id ? colors.primary : colors.text} /></Pressable>)}</ScrollView>}
        <Pressable accessibilityRole="button" accessibilityLabel={commsExpanded ? "Exit full screen" : "Expand Communications to full screen"} accessibilityState={{ expanded: commsExpanded }} onPress={() => setCommsExpanded(value => !value)} style={{ marginLeft: "auto", minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}><Ionicons name={commsExpanded ? "contract-outline" : "expand-outline"} size={22} color={colors.text} /></Pressable>
      </View>
      {section === "home" ? <ScrollView nestedScrollEnabled style={{ flex: commsExpanded ? 1 : undefined, maxHeight: commsExpanded ? undefined : Math.max(240, Math.min(520, height * 0.55)), borderWidth: 1, borderColor: colors.primary, borderRadius: 12 }}>
        {rows.map(row => <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={row.label} onPress={() => setSection(row.id)} style={rowStyle}>
          <Ionicons name={row.icon} size={20} color={colors.primary} /><Text style={{ flex: 1, color: colors.text, fontWeight: "600" }}>{row.label}</Text><Text style={{ color: colors.mutedForeground }}>{row.count ?? "…"}</Text><Ionicons name="chevron-forward" size={17} color={colors.primary} />
        </Pressable>)}
        <Pressable accessibilityRole="button" accessibilityLabel="Needs attention" accessibilityState={{ expanded: attentionOpen }} onPress={() => setAttentionOpen(open => !open)} style={rowStyle}>
          <Ionicons name="alert-circle-outline" size={20} color={colors.primary} /><Text style={{ flex: 1, color: colors.text, fontWeight: "600" }}>Needs attention</Text><Text style={{ color: colors.mutedForeground }}>{unreadVoicemail.length + noticeRows.filter(row => !row.isRead).length}</Text><Ionicons name={attentionOpen ? "chevron-down" : "chevron-forward"} size={17} color={colors.primary} />
        </Pressable>
        {attentionOpen && <View style={{ paddingHorizontal: 16 }}>
          {unreadVoicemail.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Voicemail from ${item.senderName}`} onPress={() => setSection("calls")} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}><Text style={{ color: colors.text, fontWeight: "600" }}>{item.senderName}</Text><Text style={{ color: colors.mutedForeground }}>{item.transcript || "Voicemail"}</Text></Pressable>)}
          {noticeRows.some(row => !row.isRead) && <Pressable accessibilityRole="button" onPress={() => setSection("notifications")} style={{ paddingVertical: 12 }}><Text style={{ color: colors.primary }}>Review notifications</Text></Pressable>}
          {!unreadVoicemail.length && !noticeRows.some(row => !row.isRead) && <Text style={{ color: colors.mutedForeground, paddingVertical: 12 }}>Nothing needs attention.</Text>}
        </View>}
      </ScrollView> : null}
    {section === "email" || section === "connected" ? <ConnectedWorkspace selection={section === "email" ? null : connectedSelection} onSelect={openConnected} onBack={() => {setConnectedSelection(null);setSection("email");}} />
      : section === "home" ? null
      : section === "polls" ? <ScrollView contentContainerStyle={{ padding: 16 }}><FormCampaignList /></ScrollView>
      : section === "notifications" ? <View style={{ flex: 1, borderWidth: 1, borderColor: colors.primary, borderRadius: 12, overflow: "hidden" }}><React.Suspense fallback={<ActivityIndicator color={colors.primary} />}><NotificationsScreen embedded onBack={() => setSection("home")} /></React.Suspense></View>
      : <View style={{ flex: 1, borderWidth: 1, borderColor: colors.primary, borderRadius: 12, overflow: "hidden" }}><WorkHubModuleWorkspace key={section} onConnectedSelect={openConnected} module={section === "channels" ? "communication-channels" : section} embedded /></View>}
    </View>
    <View style={{ padding: 16 }}><CommunicationConnections /></View>
    </View>
  </View>;
}

export function WorkHubModuleWorkspace({ module, embedded = false, onConnectedSelect }: { module?: string; embedded?: boolean; onConnectedSelect?: (value: ConnectedSelection) => void }) {
  const { user } = useAuth();
  // Local protected results and drafts belong to one authentication/membership
  // generation, even if Expo keeps this route mounted while the context changes.
  const scopeKey = `${user?.id}:${user?.activeMembershipId}:${user?.vendorId}:${user?.partnerId}:${captureAuthScope().generation}`;
  return <WorkHubModuleContent key={scopeKey} module={module} embedded={embedded} onConnectedSelect={onConnectedSelect} />;
}

function WorkHubModuleContent({ module: forcedModule, embedded = false, onConnectedSelect }: { module?: string; embedded?: boolean; onConnectedSelect?: (value: ConnectedSelection) => void }) {
  const { t } = useTranslation();
  const colors = useColors();
  const { user } = useAuth();
  const meetingCompanion = useMeetingCompanion();
  const routeParams = useLocalSearchParams<{
    module: string;
    assetId?: string;
    q?: string;
    start?: string;
    end?: string;
    type?: string;
    siteId?: string;
    stationId?: string;
    shiftId?: string;
    date?: string;
  }>();
  const {
    module: raw,
    assetId: selectedAssetId,
    q: searchQuery,
    start: searchStart,
    end: searchEnd,
    type: searchType,
  } = routeParams;
  const staffingContext = parseGateStaffingCalendarParams(routeParams);
  const module = forcedModule ??
    (raw === "inventory" ? "files-notes" : String(raw ?? "channels"));
  const owner = mobileOwner(user);
  const activeMembership = user?.availableMemberships?.find(
    (membership) => membership.id === user.activeMembershipId,
  );
  const title =
    module === "chat"
      ? "Communications"
      : module === "files-notes"
        ? t("filesInventory.title")
        : (titles[module] ?? "Work Hub");
  const canManage =
    user?.role === "admin" || activeMembership?.role === "admin";
  const [newConversation, setNewConversation] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<Row | null>(null);
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);
  const [draft, setDraft] = useState("");
  const [meetingFileBusy, setMeetingFileBusy] = useState(false);
  const [meetingFileNotice, setMeetingFileNotice] = useState("");
  const [meetingFileError, setMeetingFileError] = useState("");
  const [chatGroups, setChatGroups] = useState<Row[]>([]);
  const [chatPeople, setChatPeople] = useState<Row[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [chatActionBusy, setChatActionBusy] = useState(false);
  const [chatActionNotice, setChatActionNotice] = useState("");
  const loadController = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      loadController.current?.abort();
    },
    [],
  );
  const load = useCallback(
    async (search = "") => {
      const authScope = captureAuthScope();
      const controller = new AbortController();
      loadController.current?.abort();
      loadController.current = controller;
      const current = () =>
        loadController.current === controller &&
        !controller.signal.aborted &&
        isAuthScopeCurrent(authScope);
      const fetchScoped = (path: string) =>
        apiFetch(path, { signal: controller.signal }, authScope);
      setLoading(true);
      setError("");
      if (module === "files-notes" || module === "assets") setData(undefined);
      try {
        if (user) await flushNativeWorkHubQueue(user);
        if (!current()) return;
        let result: unknown;
        if (module === "files-notes") {
          const currentOwner = mobileOwner(user);
          if (!currentOwner) throw new Error(t("filesInventory.chooseCompany"));
          result = await loadFilesInventoryData(currentOwner, fetchScoped);
        } else if (module === "assets") {
          const currentOwner = mobileOwner(user);
          if (!currentOwner) throw new Error(t("filesInventory.chooseCompany"));
          const [assetResult, home] = await Promise.all([
            fetchScoped("/api/implementation-a/assets"),
            fetchScoped("/api/work-hub/home"),
          ]);
          const assetData = assetResult as { assets?: Row[]; capabilities?: Row } | Row[];
          result = {
            assets: Array.isArray(assetData) ? assetData : assetData.assets ?? [],
            capabilities: { ...(home as { capabilities?: Row }).capabilities, ...(!Array.isArray(assetData) ? assetData.capabilities : {}) },
          };
        } else result = await fetchScoped(moduleEndpoint(module, search));
        if (current()) {
          setData(result);
          if (
            user &&
            ["files-notes", "tasks-forms", "calendar"].includes(module)
          )
            await cacheAssignedRead(user, `workhub.${module}`, result);
        }
      } catch (e) {
        if (current()) {
          const cached =
            user &&
            isOfflineWorkHubFailure(e) &&
            ["files-notes", "tasks-forms", "calendar"].includes(module)
              ? await readAssignedCache(user, `workhub.${module}`)
              : null;
          if (!current()) return;
          setData(cached?.value);
          setError(
            cached
              ? t("nativeJournal.cached", {
                  time: new Date(cached.capturedAt).toLocaleString(),
                })
              : e instanceof Error
                ? e.message
                : "Could not load Work Hub",
          );
        }
      } finally {
        if (current()) setLoading(false);
      }
    },
    [module, user, t],
  );
  useFocusEffect(
    useCallback(() => {
      if (module === "tasks-forms") void load("");
    }, [module, load]),
  );
  useEffect(() => {
    if (
      !["attention", "safety", "my-work", "calendar"].includes(module) &&
      module !== "calls" &&
      module !== "files" &&
      module !== "search" &&
      module !== "safety-response" &&
      module !== "implementation-exports"
    )
      void load("");
  }, [module, load]);
  useEffect(() => {
    if (module !== "chat" && module !== "communication-channels" && module !== "communication-home") return;
    let active = true;
    Promise.all([
      apiFetch<Row[]>("/api/work-hub/crews"),
      apiFetch<Row[]>("/api/work-hub/people"),
    ])
      .then(([groups, people]) => {
        if (!active) return;
        setChatGroups(groups);
        setChatPeople(people);
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load chat targets",
          );
      });
    return () => {
      active = false;
    };
  }, [module]);
  const rows = useMemo<Row[]>(() => {
    if (Array.isArray(data)) return data;
    if (module === "calendar")
      return [
        ...(data?.shifts ?? []).map((x: Row) => ({ ...x.item, kind: "Shift" })),
        ...(data?.tasks ?? []).map((x: Row) => ({ ...x.item, kind: "Task" })),
        ...(data?.meetings ?? []).map((x: Row) => ({
          ...(x.occurrence ?? x.item?.occurrence),
          title: (x.meeting ?? x.item?.meeting)?.title,
          admissionMode: (x.meeting ?? x.item?.meeting)?.admissionMode,
          invited:
            !!(x.participant ?? x.item?.participant) &&
            (x.participant ?? x.item?.participant)?.role !== "host",
          kind: "Meeting",
        })),
      ];
    if (module === "meetings")
      return (data?.meetings ?? []).map((x: Row) => ({
        ...(x.occurrence ?? x.item?.occurrence),
        title: (x.meeting ?? x.item?.meeting)?.title,
        agenda: (x.meeting ?? x.item?.meeting)?.agenda,
        attendanceConfirmationRequired: (x.meeting ?? x.item?.meeting)
          ?.attendanceConfirmationRequired,
        kind: "Meeting",
      }));
    if (module === "search") return data?.results ?? [];
    return [];
  }, [data, module]);
  useEffect(() => {
    if (!selectedChannel?.id) return;
    const current = rows.find(row => row.id === selectedChannel.id);
    if (current) setSelectedChannel(current);
  }, [rows, selectedChannel?.id]);
  const complete = async (row: Row) => {
    if (!owner || isCoordinatedPlanDescription(row.description)) return;
    const body = envelope(owner, { status: "completed" }, row.version);
    const path = `/api/work-hub/tasks/${row.id}`;
    try {
      await apiFetch(path, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await load();
    } catch (e) {
      if (user && isOfflineWorkHubFailure(e)) {
        await queueNativeWorkHubRequest(user, path, "PATCH", body);
        setError(
          "Saved securely on this device. The task will update when you reconnect.",
        );
      } else setError(e instanceof Error ? e.message : "Could not update task");
    }
  };
  const quickCreate = async () => {
    if (!owner || !draft.trim()) return;
    const targets: Record<string, { path: string; payload: Row }> = {
      channels: { path: "/api/work-hub/crews", payload: { name: draft } },
      "tasks-forms": {
        path: "/api/work-hub/tasks",
        payload: {
          title: draft,
          priority: "normal",
          assigneeUserId: user?.id ?? null,
        },
      },
    };
    const target = targets[module];
    if (!target) return;
    const body =
      module === "channels"
        ? { operationId: Crypto.randomUUID(), owner, name: draft.trim() }
        : envelope(owner, target.payload, undefined);
    try {
      await apiFetch(target.path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setDraft("");
      await load();
    } catch (e) {
      if (user && isOfflineWorkHubFailure(e)) {
        await queueNativeWorkHubRequest(user, target.path, "POST", body);
        setDraft("");
        setError(
          "Saved securely on this device. It will send when you reconnect.",
        );
      } else {
        setError(
          e instanceof Error ? e.message : "Could not create Work Hub record",
        );
      }
    }
  };
  const startChat = async () => {
    if (!selectedGroupId && !selectedPersonId) return;
    setChatActionBusy(true);
    setChatActionNotice("");
    try {
      const response = selectedGroupId
        ? await apiFetch<Row>("/api/work-hub/chats/groups", {
            method: "POST",
            body: JSON.stringify({
              crewId: selectedGroupId,
              operationId: Crypto.randomUUID(),
            }),
          })
        : await apiFetch<Row>("/api/work-hub/chats", {
            method: "POST",
            body: JSON.stringify({ recipientUserId: Number(selectedPersonId) }),
          });
      if (response.channel) setSelectedChannel(response.channel);
      else setChatActionNotice("Invitation sent");
      setSelectedGroupId("");
      setSelectedPersonId("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start chat");
    } finally {
      setChatActionBusy(false);
    }
  };
  const uploadToActiveMeeting = async (source: MeetingFileSource) => {
    const active = meetingCompanion?.active;
    if (!active || meetingFileBusy) return;
    setMeetingFileBusy(true);
    setMeetingFileNotice("");
    setMeetingFileError("");
    try {
      const file = await pickMeetingFile(source);
      if (!file) return;
      const authScope = captureAuthScope();
      try {
        await uploadMeetingFile(active.occurrenceId, file, null, authScope);
        setMeetingFileNotice(`File added to ${active.title}.`);
      } catch (cause) {
        if (!user || !isOfflineWorkHubFailure(cause)) throw cause;
        const path = `/api/work-hub/meetings/${encodeURIComponent(active.occurrenceId)}/files/${encodeURIComponent(file.id)}`;
        const uri = persistMeetingFileForOffline(file);
        await queueNativeWorkHubUpload(
          user,
          path,
          uri,
          file.type,
          [],
          { "x-file-name": encodeURIComponent(file.name) },
          true,
          file.id,
        );
        setMeetingFileNotice(
          `File saved securely and will be added to ${active.title} when you reconnect.`,
        );
      }
    } catch (cause) {
      setMeetingFileError(
        cause instanceof Error ? cause.message : "The file could not be added.",
      );
    } finally {
      setMeetingFileBusy(false);
    }
  };
  if (["attention", "safety", "my-work", "calendar"].includes(module))
    return (
      <ScreenSafeArea>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          <WorkHubPageTitle
            title={
              module === "attention"
                ? "Needs Attention"
                : module === "safety"
                  ? "Safety"
                  : module === "my-work"
                    ? "My Work"
                    : "Calendar"
            }
          />
          {module === "safety" && <SafetyDashboardCard />}
          {module === "calendar" ? (
            <>
            <CalendarOverviewCards />
            <UnifiedWorkCalendar staffingContext={staffingContext} />
            <View style={{ backgroundColor: colors.card, borderColor: colors.primary, borderWidth: 1, borderRadius: 14, padding: 16 }}><WorkHubAwaySettings inline showSetup /></View>
            </>
          ) : (
            <DailyWorkPanel
              mode={module as "attention" | "safety" | "my-work"}
            />
          )}
        </ScrollView>
      </ScreenSafeArea>
    );
  if (
    [
      "managed-crews",
      "implementation-exports",
    ].includes(module)
  )
    return (
      <ScreenSafeArea style={{ backgroundColor: colors.background }}>
        <Stack.Screen options={{ title }} />
        <ScrollView
          refreshControl={
            ["safety-response", "implementation-exports"].includes(
              module,
            ) ? undefined : (
              <RefreshControl refreshing={loading} onRefresh={() => load()} />
            )
          }
          contentContainerStyle={{ padding: 20, gap: 14 }}
        >
          {!embedded && <WorkHubPageTitle title={title} afterTitle={module === "managed-crews" ? <Text style={{ color: "#b3b3b3", fontSize: 14 }}>Manage crews, task assignments, and unassigned work.</Text> : undefined} />}
          {loading &&
          !data &&
          !["safety-response", "implementation-exports"].includes(module) ? (
            <ActivityIndicator color={colors.primary} />
          ) : null}
          {!!error && (
            <Text
              accessibilityRole="alert"
              style={{ color: colors.destructive }}
            >
              {error}
            </Text>
          )}
          {module === "managed-crews" && (
            <ManagedCrews />
          )}
          {module === "implementation-exports" && owner && (
            <RoleExports
              owner={owner}
              membershipId={user?.activeMembershipId}
            />
          )}
        </ScrollView>
      </ScreenSafeArea>
    );
  if (module === "calls")
    return (
      <ScreenSafeArea style={{ backgroundColor: colors.background }}>
        <Stack.Screen options={{ title: "Calls" }} />
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          {!embedded && <WorkHubPageTitle title="Calls" />}
          <WorkHubCalls embedded={embedded} />
        </ScrollView>
      </ScreenSafeArea>
    );
  if (module === "files")
    return (
      <ScreenSafeArea style={{ backgroundColor: colors.background }}>
        <Stack.Screen options={{ title }} />
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          {!embedded && <WorkHubPageTitle title={title} />}
          <NativeRepository filesOnly />
        </ScrollView>
      </ScreenSafeArea>
    );
  if (module === "search") {
    const open = (destination: WorkHubSearchDestination) => {
      if (destination.module === "meeting" && destination.occurrenceId) {
        router.push(
          `/work-hub/meeting/${encodeURIComponent(destination.occurrenceId)}` as never,
        );
      } else if (destination.module === "files-notes" && destination.assetId) {
        router.push({
          pathname: "/work-hub/[module]",
          params: {
            module: "files-notes",
            section: "inventory",
            assetId: destination.assetId,
          },
        } as never);
      } else if (destination.itemId && destination.section) {
        router.push(
          `/work-hub/search-item/${encodeURIComponent(destination.section)}/${encodeURIComponent(destination.itemId)}` as never,
        );
      }
    };
    return (
      <ScreenSafeArea style={{ backgroundColor: colors.background }}>
        <Stack.Screen options={{ title }} />
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          {!embedded && <WorkHubPageTitle title={title} />}
          <WorkHubSearch
            embedded={embedded}
            key={`${searchQuery}:${searchStart}:${searchEnd}:${searchType}`}
            onOpen={open}
            initialFilters={{
              query: searchQuery ?? "",
              start: searchStart,
              end: searchEnd,
              types: searchType?.split(","),
            }}
          />
        </ScrollView>
      </ScreenSafeArea>
    );
  }
  if (module === "chat" || module === "communication-channels" || module === "communication-home")
    return (
      <ScreenSafeArea style={{ backgroundColor: colors.background }}>
        <Stack.Screen options={{ title }} />
        <ScrollView
          contentContainerStyle={{ padding: 20, gap: 14, flexGrow: 1 }}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={() => load()} />
          }
        >
          {!embedded && <WorkHubPageTitle title={title} />}
          {!!error && (
            <Text
              accessibilityRole="alert"
              style={{ color: colors.destructive }}
            >
              {error}
            </Text>
          )}
          {loading && !data && <ActivityIndicator color={colors.primary} />}
          <DismissibleModal visible={newConversation} transparent animationType="fade" onRequestClose={() => setNewConversation(false)}>
            <View style={{ flex: 1, padding: 20, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center" }}><View style={{ backgroundColor: colors.card, padding: 16, borderRadius: 12, borderColor: colors.primary, borderWidth: 1 }}>
              <NewConversation kind={module === "communication-channels" ? "channel" : "chat"} onCancel={() => setNewConversation(false)} onCreated={id => { setNewConversation(false); setSelectedChannel({ id }); void load(); }} />
            </View></View>
          </DismissibleModal>
          {onConnectedSelect && <ConnectorTree kind={module === "communication-channels" ? "channels" : "chats"} onSelect={onConnectedSelect} />}
          <WorkHubChatInbox
            title={module === "communication-home" ? "Conversations" : module === "communication-channels" ? "Channels" : "Chats"}
            canCreate={module !== "communication-channels" || canManage || ["office", "both"].includes(user?.vendorRole ?? "")}
            onNew={() => setNewConversation(true)}
            channels={rows.filter(row => module === "communication-home" ? true : module === "communication-channels" ? row.contextKind !== "chat" || String(row.contextId ?? "").startsWith("group:") : row.contextKind === "chat" && !String(row.contextId ?? "").startsWith("group:"))}
            groups={chatGroups}
            people={chatPeople}
            selected={selectedChannel}
            onSelect={setSelectedChannel}
            target={selectedGroupId || selectedPersonId}
            onTarget={(kind, id) => {
              setSelectedGroupId(kind === "group" ? id : "");
              setSelectedPersonId(kind === "person" ? id : "");
            }}
            onStart={() => void startChat()}
            busy={chatActionBusy}
            notice={chatActionNotice}
          />
        </ScrollView>
      </ScreenSafeArea>
    );
  return (
    <ScreenSafeArea style={{ backgroundColor: colors.background }}>
      <Stack.Screen options={{ title }} />
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => load()} />
        }
        contentContainerStyle={{ padding: 20, gap: 14 }}
      >
        {!embedded && <WorkHubPageTitle title={title} />}
        {module === "files-notes" && (
          <EquipmentWorkbench
            initialAssetId={selectedAssetId}
            onSaved={() => load()}
          />
        )}
        {module === "files-notes" && owner && data?.capabilities && (
          <FilesInventory
            owner={owner}
            capabilities={data.capabilities}
            files={data.files ?? []}
            notes={data.notes ?? []}
            assets={data.assets ?? []}
            channels={data.channels ?? []}
            selectedAssetId={selectedAssetId}
            onRefresh={() => load()}
          />
        )}
        {module === "assets" && owner && data?.capabilities && (
          <FilesInventory
            owner={owner}
            capabilities={data.capabilities}
            files={[]}
            notes={[]}
            assets={data.assets ?? []}
            channels={[]}
            inventoryOnly
            onRefresh={() => load()}
          />
        )}
        {module === "files-notes" && !loading && data && !data.capabilities && (
          <Text style={{ color: colors.mutedForeground }}>
            {t("filesInventory.noAccess")}
          </Text>
        )}
        {module === "calendar" ? <WorkHubShiftCalendar items={rows} /> : null}
        {module === "files-notes" && meetingCompanion?.active && (
          <View
            accessibilityLabel="Active meeting upload"
            style={{
              borderWidth: 1,
              borderColor: colors.primary,
              borderRadius: 12,
              padding: 16,
              gap: 10,
              backgroundColor: colors.card,
            }}
          >
            <Text
              style={{ color: colors.text, fontWeight: "700", fontSize: 17 }}
            >
              Sharing to: {meetingCompanion.active.title}
            </Text>
            <Text style={{ color: colors.mutedForeground }}>
              The active meeting is selected. Return to the meeting to choose a
              private recipient.
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <TogglePillButton
                color="brand"
                disabled={meetingFileBusy}
                loading={meetingFileBusy}
                accessibilityLabel="Take a photo for the active meeting"
                onPress={() => void uploadToActiveMeeting("camera")}
              >
                Camera
              </TogglePillButton>
              <TogglePillButton
                color="brand"
                disabled={meetingFileBusy}
                loading={meetingFileBusy}
                accessibilityLabel="Choose a photo for the active meeting"
                onPress={() => void uploadToActiveMeeting("photos")}
              >
                Photos
              </TogglePillButton>
              <TogglePillButton
                color="brand"
                disabled={meetingFileBusy}
                loading={meetingFileBusy}
                accessibilityLabel="Choose a file for the active meeting"
                onPress={() => void uploadToActiveMeeting("files")}
              >
                Files
              </TogglePillButton>
              <TogglePillButton
                color="brand"
                accessibilityLabel="Return to active meeting"
                onPress={() =>
                  router.push(
                    `/work-hub/meeting/${meetingCompanion.active!.occurrenceId}` as never,
                  )
                }
              >
                Change destination
              </TogglePillButton>
            </View>
            {!!meetingFileNotice && (
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: colors.text, fontWeight: "700" }}
              >
                {meetingFileNotice}
              </Text>
            )}
            {!!meetingFileError && (
              <Text
                accessibilityRole="alert"
                style={{ color: colors.destructive, fontWeight: "700" }}
              >
                {meetingFileError}
              </Text>
            )}
          </View>
        )}
        {module === "meetings" && (
          <WorkHubMeetings
            meetings={rows.map((row) => ({
              id: String(row.id),
              title: row.title,
              agenda: row.agenda,
              attendanceConfirmationRequired:
                row.attendanceConfirmationRequired,
              startsAt: row.startsAt,
              endsAt: row.endsAt,
              status: row.status,
              invited: row.invited,
              admissionMode: row.admissionMode,
            }))}
            onOpen={(id) => router.push(`/work-hub/meeting/${id}` as never)}
            onSaved={() => load("")}
          />
        )}
        {module === "calendar" && <WorkHubAvailability />}
        {module === "calendar" && <ShiftScheduling onSaved={() => load("")} />}
        {module === "calendar" && (
          <WorkHubShiftOpening
            shifts={data?.shifts ?? []}
            onSaved={() => load("")}
          />
        )}
        {owner && canManage && module === "tasks-forms" && (
          <>
            <TaskAssignment onSaved={() => load()} />
          </>
        )}
        {module === "tasks-forms" && (
          <View style={{ flexDirection: "row", gap: 8 }}>
            {[false, true].map((value) => (
              <Pressable
                key={String(value)}
                accessibilityRole="button"
                accessibilityState={{ selected: showCompleted === value }}
                onPress={() => setShowCompleted(value)}
              >
                <Text
                  style={{
                    color:
                      showCompleted === value ? colors.primary : colors.text,
                    fontWeight: showCompleted === value ? "700" : "400",
                  }}
                >
                  {value ? "| " : ""}
                  {t(
                    value
                      ? "workHubLibrary.complete"
                      : "workHubLibrary.incomplete",
                  )}
                </Text>
              </Pressable>
            ))}{" "}
          </View>
        )}
        {module === "tasks-forms" && (
          <AssignedCards completed={showCompleted} />
        )}
        {["tasks-forms", "my-work"].includes(module) && (
          <FormCampaignList
            completed={module === "tasks-forms" ? showCompleted : undefined}
          />
        )}
        {owner && canManage && module === "channels" && (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                accessibilityLabel={`New ${title} item`}
                value={draft}
                onChangeText={setDraft}
                placeholder={`New ${title.toLowerCase()} item`}
                placeholderTextColor={colors.mutedForeground}
                style={{
                  flex: 1,
                  color: colors.text,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 10,
                  minHeight: 44,
                  padding: 12,
                }}
              />
              <Pressable
                accessibilityRole="button"
                onPress={quickCreate}
                style={{
                  backgroundColor: colors.primary,
                  borderRadius: 10,
                  minHeight: 44,
                  padding: 12,
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{ color: colors.primaryForeground, fontWeight: "700" }}
                >
                  Create
                </Text>
              </Pressable>
            </View>
          </View>
        )}
        {loading && !data && <ActivityIndicator color={colors.primary} />}{" "}
        {!!error && (
          <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
            {error}
          </Text>
        )}
        {selectedChannel && (
          <WorkHubConversation
            channel={selectedChannel}
            onClose={() => setSelectedChannel(null)}
          />
        )}
        {!selectedChannel &&
          module !== "meetings" &&
          rows
            .filter(
              (row) =>
                module !== "tasks-forms" ||
                (showCompleted
                  ? row.status === "completed"
                  : !["completed", "cancelled"].includes(row.status)),
            )
            .map((row) => (
              <View
                key={row.id}
                style={{
                  borderWidth: module === "tasks-forms" ? 2 : 1,
                  borderColor:
                    module === "tasks-forms" ? colors.primary : colors.border,
                  borderRadius: 12,
                  padding: 16,
                  gap: 6,
                  backgroundColor: colors.card,
                }}
              >
                <Text
                  style={{
                    color: colors.primary,
                    fontSize: 11,
                    fontWeight: "700",
                    textTransform: "uppercase",
                  }}
                >
                  {row.kind ?? row.subjectType ?? row.status ?? "Work Hub"}
                </Text>
                <Text
                  style={{
                    color: colors.text,
                    fontSize: 17,
                    fontWeight: "700",
                  }}
                >
                  {row.title ?? row.name ?? row.fileName ?? "Untitled record"}
                </Text>
                {(row.description || row.agenda || row.body) &&
                !(
                  module === "tasks-forms" &&
                  isCoordinatedPlanDescription(row.description)
                ) ? (
                  <Text style={{ color: colors.mutedForeground }}>
                    {row.description ?? row.agenda ?? row.body}
                  </Text>
                ) : null}
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                  {row.dueAt || row.startsAt || row.createdAt
                    ? new Date(
                        row.dueAt ?? row.startsAt ?? row.createdAt,
                      ).toLocaleString()
                    : ""}
                </Text>
                {module === "meetings" && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("meetingWorkspace.openMeetingLabel", {
                      defaultValue: "Open {{name}}",
                      name: row.title ?? "meeting",
                    })}
                    onPress={() =>
                      router.push(`/work-hub/meeting/${row.id}` as never)
                    }
                    style={{ minHeight: 44, justifyContent: "center" }}
                  >
                    <Text style={{ color: colors.primary, fontWeight: "700" }}>
                      {t("meetingWorkspace.openMeeting", {
                        defaultValue: "Open meeting",
                      })}
                    </Text>
                  </Pressable>
                )}
                {module === "tasks-forms" &&
                isCoordinatedPlanDescription(row.description) ? (
                  <TogglePillButton
                    color="blue"
                    onPress={() =>
                      router.push(`/work-hub/task/${row.id}` as never)
                    }
                  >
                    {t("workPlan.open")}
                  </TogglePillButton>
                ) : null}
                {module === "tasks-forms" &&
                  row.status !== "completed" &&
                  !isCoordinatedPlanDescription(row.description) && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Complete ${row.title}`}
                      onPress={() => complete(row)}
                      style={{
                        alignSelf: "flex-start",
                        marginTop: 6,
                        backgroundColor: colors.primary,
                        borderRadius: 8,
                        paddingHorizontal: 14,
                        paddingVertical: 9,
                        minHeight: 44,
                        justifyContent: "center",
                      }}
                    >
                      <Text
                        style={{
                          color: colors.primaryForeground,
                          fontWeight: "700",
                        }}
                      >
                        Complete
                      </Text>
                    </Pressable>
                  )}
              </View>
            ))}
        {!loading &&
          module !== "meetings" &&
          module !== "settings-connections" &&
          module !== "calendar" &&
          module !== "files-notes" &&
          module !== "assets" &&
          !rows.length && (
            <Text
              style={{
                color: colors.mutedForeground,
                textAlign: "center",
                padding: 24,
              }}
            >
              No authorized records yet.
            </Text>
          )}
        {owner &&
          canManage &&
          ["channels", "calendar", "tasks-forms"].includes(module) && (
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
              Administrative creation is limited to assigned administrators.
              Invited participants can view and complete the work shared with
              them here; full template design and bulk administration remain in
              the web workspace.
            </Text>
          )}
      </ScrollView>
    </ScreenSafeArea>
  );
}
