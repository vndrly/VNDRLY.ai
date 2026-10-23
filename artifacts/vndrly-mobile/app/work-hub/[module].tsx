import SafetyDashboardCard from "@/components/SafetyDashboardCard";
import { useFocusEffect } from "expo-router";
import AssignedCards from "@/components/work-hub/library/AssignedCards";
import FormCampaignList from "@/components/work-hub/FormCampaignList";
import TaskAssignment from "@/components/work-hub/TaskAssignment";
import * as Crypto from "expo-crypto";
import { mobileCommandEnvelope } from "@/lib/work-hub-mobile";
import DailyWorkPanel from "@/components/DailyWorkPanel";
import UnifiedWorkCalendar from "@/components/UnifiedWorkCalendar";
import CalendarOverview from "@/components/CalendarOverview";
import WorkHubAvailability from "@/components/WorkHubAvailability";
import { Stack, router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import WorkHubMeetings from "@/components/WorkHubMeetings";
import ShiftScheduling from "@/components/ShiftScheduling";
import WorkHubShiftOpening from "@/components/WorkHubShiftOpening";
import WorkHubCalls from "@/components/WorkHubCalls";
import { ManagedCrews } from "@/components/implementation-a/ManagedCrews";
import { WorkforceCoverage } from "@/components/implementation-a/WorkforceCoverage";
import { FilesInventory } from "@/components/work-hub/FilesInventory";
import { WorkHubSearch, type WorkHubSearchDestination } from "@/components/work-hub/WorkHubSearch";
import { SitePresence } from "@/components/implementation-a/SitePresence";
import { SafetyResponse } from "@/components/implementation-a/SafetyResponse";
import { RoleExports } from "@/components/work-hub/RoleExports";
import { OperationsHealth } from "@/components/implementation-a/OperationsHealth";
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
import { cacheAssignedRead, readAssignedCache } from "@/lib/native-assigned-cache";
import { pickMeetingFile, persistMeetingFileForOffline, uploadMeetingFile, type MeetingFileSource } from "@/lib/meeting-files";
import { loadFilesInventoryData, mobileOwner, moduleEndpoint } from "@/lib/work-hub-mobile";
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
  "managed-crews": "Managed Crews",
  "workforce-coverage": "Workforce Coverage",
  "site-presence": "Site Presence",
  "safety-response": "Safety Response",
  "implementation-exports": "Exports",
  "operations-health": "Operations Health",
  chat: "Company Chat",
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
  context: { kind: "organization" | "gate"; id: number } = { kind: "organization", id: owner.id },
) {
  return mobileCommandEnvelope(owner,payload,expectedVersion,context,Crypto.randomUUID());
}

export default function WorkHubModuleScreen() {
  const { user } = useAuth();
  // Local protected results and drafts belong to one authentication/membership
  // generation, even if Expo keeps this route mounted while the context changes.
  const scopeKey = `${user?.id}:${user?.activeMembershipId}:${user?.vendorId}:${user?.partnerId}:${captureAuthScope().generation}`;
  return <WorkHubModuleContent key={scopeKey} />;
}

function WorkHubModuleContent() {
  const { t } = useTranslation();
  const colors = useColors();
  const { user } = useAuth();
  const meetingCompanion = useMeetingCompanion();
  const { module: raw, assetId: selectedAssetId, q: searchQuery, start: searchStart, end: searchEnd, type: searchType } = useLocalSearchParams<{ module: string; assetId?: string; q?: string; start?: string; end?: string; type?: string }>();
  const module = raw === "inventory" ? "files-notes" : String(raw ?? "channels");
  const owner = mobileOwner(user);
  const activeMembership = user?.availableMemberships?.find(
    (membership) => membership.id === user.activeMembershipId,
  );
  const title = module === "chat"
    ? `${activeMembership?.orgName?.trim() || "Company"} Chat`
    : module === "files-notes" ? t("filesInventory.title")
    : (titles[module] ?? "Work Hub");
  const canManage =
    user?.role === "admin" || activeMembership?.role === "admin";
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
  useEffect(() => () => { loadController.current?.abort(); }, []);
  const load = useCallback(
    async (search = "") => {
      const authScope = captureAuthScope();
      const controller = new AbortController();
      loadController.current?.abort();
      loadController.current = controller;
      const current = () => loadController.current === controller && !controller.signal.aborted && isAuthScopeCurrent(authScope);
      const fetchScoped = (path: string) => apiFetch(path, { signal: controller.signal }, authScope);
      setLoading(true);
      setError("");
      if (module === "files-notes") setData(undefined);
      try {
        if (user) await flushNativeWorkHubQueue(user);
        if (!current()) return;
        let result: unknown;
        if (module === "files-notes") {
          const currentOwner = mobileOwner(user);
          if (!currentOwner) throw new Error(t("filesInventory.chooseCompany"));
          result = await loadFilesInventoryData(currentOwner, fetchScoped);
        } else result = await fetchScoped(moduleEndpoint(module, search));
        if (current()) {
          setData(result);
          if (user && ["files-notes", "tasks-forms", "calendar"].includes(module)) await cacheAssignedRead(user, `workhub.${module}`, result);
        }
      } catch (e) {
        if (current()) {
          const cached = user && isOfflineWorkHubFailure(e) && ["files-notes", "tasks-forms", "calendar"].includes(module) ? await readAssignedCache(user, `workhub.${module}`) : null;
          if (!current()) return;
          setData(cached?.value); setError(cached ? t("nativeJournal.cached", { time: new Date(cached.capturedAt).toLocaleString() }) : e instanceof Error ? e.message : "Could not load Work Hub");
        }
      } finally {
        if (current()) setLoading(false);
      }
    },
    [module, user, t],
  );
  useFocusEffect(useCallback(()=>{ if(module === "tasks-forms") void load(""); },[module,load]));
  useEffect(() => {
    if (!["attention","safety","my-work","calendar"].includes(module) && module !== "calls" && module !== "search" && module !== "safety-response" && module !== "implementation-exports") void load("");
  }, [module, load]);
  useEffect(() => {
    if (module !== "chat") return;
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
        if (active) setError(cause instanceof Error ? cause.message : "Could not load chat targets");
      });
    return () => { active = false; };
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
        invited: !!(x.participant ?? x.item?.participant) && (x.participant ?? x.item?.participant)?.role !== "host",
        kind: "Meeting",
        })),
      ];
    if (module === "meetings")
      return (data?.meetings ?? []).map((x: Row) => ({
        ...(x.occurrence ?? x.item?.occurrence),
        title: (x.meeting ?? x.item?.meeting)?.title,
        agenda: (x.meeting ?? x.item?.meeting)?.agenda,
        attendanceConfirmationRequired: (x.meeting ?? x.item?.meeting)?.attendanceConfirmationRequired,
        kind: "Meeting",
      }));
    if (module === "search") return data?.results ?? [];
    return [];
  }, [data, module]);
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
    const body = module === "channels"
      ? { operationId: Crypto.randomUUID(), owner, name: draft.trim() }
      : envelope(
          owner,
          target.payload,
          undefined,
        );
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
        await queueNativeWorkHubUpload(user, path, uri, file.type, [], { "x-file-name": encodeURIComponent(file.name) }, true, file.id);
        setMeetingFileNotice(`File saved securely and will be added to ${active.title} when you reconnect.`);
      }
    } catch (cause) {
      setMeetingFileError(cause instanceof Error ? cause.message : "The file could not be added.");
    } finally {
      setMeetingFileBusy(false);
    }
  };
  if (["attention","safety","my-work","calendar"].includes(module)) return <ScreenSafeArea><ScrollView contentContainerStyle={{padding:20,gap:14}}><WorkHubPageTitle title={module==="attention"?"Needs Attention":module==="safety"?"Safety":module==="my-work"?"My Work":"Calendar"}/>{module==="safety" && <SafetyDashboardCard/>}{module==="calendar"?<CalendarOverview><UnifiedWorkCalendar/></CalendarOverview>:<DailyWorkPanel mode={module as "attention"|"safety"|"my-work"}/>}</ScrollView></ScreenSafeArea>;
  if (["managed-crews", "workforce-coverage", "site-presence", "safety-response", "implementation-exports", "operations-health"].includes(module))
    return (
      <ScreenSafeArea style={{ backgroundColor: colors.background }}>
        <Stack.Screen options={{ title }} />
        <ScrollView refreshControl={["safety-response", "implementation-exports"].includes(module) ? undefined : <RefreshControl refreshing={loading} onRefresh={() => load()} />} contentContainerStyle={{ padding: 20, gap: 14 }}>
          <WorkHubPageTitle title={title} />
          {loading && !data && !["safety-response", "implementation-exports"].includes(module) ? <ActivityIndicator color={colors.primary} /> : null}
          {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
          {module === "managed-crews" && <ManagedCrews sponsorships={data?.sponsorships ?? []} />}
          {module === "workforce-coverage" && <WorkforceCoverage gaps={data?.gaps ?? []} />}
          {module === "site-presence" && <SitePresence people={data?.people ?? data?.workers ?? []} canSeeExactLocation={canManage} />}
          {module === "safety-response" && <SafetyResponse />}
          {module === "implementation-exports" && owner && <RoleExports owner={owner} membershipId={user?.activeMembershipId} />}
          {module === "operations-health" && <OperationsHealth health={data} admin={canManage} />}
        </ScrollView>
      </ScreenSafeArea>
    );
  if (module === "calls")
    return (
      <ScreenSafeArea style={{ backgroundColor: colors.background }}>
        <Stack.Screen options={{ title: "Calls" }} />
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          <WorkHubPageTitle title="Calls" />
          <WorkHubCalls />
        </ScrollView>
      </ScreenSafeArea>
    );
  if (module === "search") {
    const open = (destination: WorkHubSearchDestination) => {
      if (destination.module === "meeting" && destination.occurrenceId) {
        router.push(`/work-hub/meeting/${encodeURIComponent(destination.occurrenceId)}` as never);
      } else if (destination.module === "files-notes" && destination.assetId) {
        router.push({ pathname: "/work-hub/[module]", params: { module: "files-notes", section: "inventory", assetId: destination.assetId } } as never);
      } else if (destination.itemId && destination.section) {
        router.push(`/work-hub/search-item/${encodeURIComponent(destination.section)}/${encodeURIComponent(destination.itemId)}` as never);
      }
    };
    return <ScreenSafeArea style={{ backgroundColor: colors.background }}>
      <Stack.Screen options={{ title }} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <WorkHubPageTitle title={title} />
        <WorkHubSearch key={`${searchQuery}:${searchStart}:${searchEnd}:${searchType}`} onOpen={open} initialFilters={{ query: searchQuery ?? "", start: searchStart, end: searchEnd, types: searchType?.split(",") }} />
      </ScrollView>
    </ScreenSafeArea>;
  }
  if (module === "chat") return <ScreenSafeArea style={{ backgroundColor: colors.background }}><Stack.Screen options={{ title }} /><ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} />}><WorkHubPageTitle title={title} />{!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}{loading && !data && <ActivityIndicator color={colors.primary} />}<WorkHubChatInbox channels={rows} groups={chatGroups} people={chatPeople} selected={selectedChannel} onSelect={setSelectedChannel} target={selectedGroupId || selectedPersonId} onTarget={(kind, id) => { setSelectedGroupId(kind === "group" ? id : ""); setSelectedPersonId(kind === "person" ? id : ""); }} onStart={() => void startChat()} busy={chatActionBusy} notice={chatActionNotice} /></ScrollView></ScreenSafeArea>;
  return (
    <ScreenSafeArea style={{ backgroundColor: colors.background }}>
      <Stack.Screen options={{ title }} />
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => load()} />
        }
        contentContainerStyle={{ padding: 20, gap: 14 }}
      >
        <WorkHubPageTitle title={title} />
        {module === "files-notes" && owner && data?.capabilities && <FilesInventory owner={owner} capabilities={data.capabilities} files={data.files ?? []} notes={data.notes ?? []} assets={data.assets ?? []} channels={data.channels ?? []} selectedAssetId={selectedAssetId} onRefresh={() => load()} />}
        {module === "files-notes" && !loading && data && !data.capabilities && <Text style={{ color: colors.mutedForeground }}>{t("filesInventory.noAccess")}</Text>}
        {module === "calendar" ? <WorkHubShiftCalendar items={rows} /> : null}
        {module === "files-notes" && meetingCompanion?.active && (
          <View accessibilityLabel="Active meeting upload" style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 12, padding: 16, gap: 10, backgroundColor: colors.card }}>
            <Text style={{ color: colors.text, fontWeight: "700", fontSize: 17 }}>Sharing to: {meetingCompanion.active.title}</Text>
            <Text style={{ color: colors.mutedForeground }}>The active meeting is selected. Return to the meeting to choose a private recipient.</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <TogglePillButton color="brand" disabled={meetingFileBusy} loading={meetingFileBusy} accessibilityLabel="Take a photo for the active meeting" onPress={() => void uploadToActiveMeeting("camera")}>Camera</TogglePillButton>
              <TogglePillButton color="brand" disabled={meetingFileBusy} loading={meetingFileBusy} accessibilityLabel="Choose a photo for the active meeting" onPress={() => void uploadToActiveMeeting("photos")}>Photos</TogglePillButton>
              <TogglePillButton color="brand" disabled={meetingFileBusy} loading={meetingFileBusy} accessibilityLabel="Choose a file for the active meeting" onPress={() => void uploadToActiveMeeting("files")}>Files</TogglePillButton>
              <TogglePillButton color="brand" accessibilityLabel="Return to active meeting" onPress={() => router.push(`/work-hub/meeting/${meetingCompanion.active!.occurrenceId}` as never)}>Change destination</TogglePillButton>
            </View>
            {!!meetingFileNotice && <Text accessibilityLiveRegion="polite" style={{ color: colors.text, fontWeight: "700" }}>{meetingFileNotice}</Text>}
            {!!meetingFileError && <Text accessibilityRole="alert" style={{ color: colors.destructive, fontWeight: "700" }}>{meetingFileError}</Text>}
          </View>
        )}
        {module === "meetings" && <WorkHubMeetings meetings={rows.map(row => ({ id: String(row.id), title: row.title, agenda: row.agenda, attendanceConfirmationRequired: row.attendanceConfirmationRequired, startsAt: row.startsAt, endsAt: row.endsAt, status: row.status, invited: row.invited, admissionMode: row.admissionMode }))} onOpen={(id) => router.push(`/work-hub/meeting/${id}` as never)} onSaved={() => load("")} />}
        {module === "calendar" && <WorkHubAvailability />}
        {module === "calendar" && <ShiftScheduling onSaved={() => load("")} />}
              {module === "calendar" && <WorkHubShiftOpening shifts={data?.shifts ?? []} onSaved={() => load("")} />}
        {owner && canManage && module === "tasks-forms" && <><TaskAssignment onSaved={()=>load()} /><TogglePillButton color="brand" onPress={()=>router.push("/work-hub/library" as never)}>{t("workHubLibrary.manage")}</TogglePillButton></>}
        {module === "tasks-forms" && <View style={{flexDirection:"row",gap:8}}>{[false,true].map(value=><Pressable key={String(value)} accessibilityRole="button" accessibilityState={{selected:showCompleted===value}} onPress={()=>setShowCompleted(value)}><Text style={{color:showCompleted===value?colors.primary:colors.text,fontWeight:showCompleted===value?"700":"400"}}>{value?"| ":""}{t(value?"workHubLibrary.complete":"workHubLibrary.incomplete")}</Text></Pressable>)} </View>}
        {module === "tasks-forms" && <AssignedCards completed={showCompleted}/>}
        {["tasks-forms","my-work"].includes(module) && <FormCampaignList completed={module === "tasks-forms" ? showCompleted : undefined}/>}
        {owner &&
          canManage &&
          module === "channels" && (
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
        {module === "settings-connections" && (
          <View
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: 16,
              gap: 10,
            }}
          >
            <Text
              style={{ color: colors.text, fontWeight: "700", fontSize: 17 }}
            >
              Microsoft 365 one-way import
            </Text>
            <Text style={{ color: colors.mutedForeground }}>
              Microsoft is optional and{" "}
              {data?.configured
                ? "awaiting an authorized administrator connection"
                : "unavailable until credentials are configured"}
              .
            </Text>
            <Text style={{ color: colors.text }}>
              Admins preview and confirm imported copies. VNDRLY records retain
              provenance, external IDs, timestamps, deduplication, permission
              mapping, progress, errors, and audit history.
            </Text>
            <Text style={{ color: colors.text, fontWeight: "700" }}>
              VNDRLY never sends changes back to Microsoft. After activation,
              Work Hub is authoritative.
            </Text>
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
        {!selectedChannel && module !== "meetings" &&
          rows.filter(row=>module !== "tasks-forms" || (showCompleted ? row.status === "completed" : !["completed","cancelled"].includes(row.status))).map((row) => (
            <View
              key={row.id}
              style={{
                borderWidth: module === "tasks-forms" ? 2 : 1,
                borderColor: module === "tasks-forms" ? colors.primary : colors.border,
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
                style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}
              >
                {row.title ?? row.name ?? row.fileName ?? "Untitled record"}
              </Text>
              {(row.description || row.agenda || row.body) && !(module === "tasks-forms" && isCoordinatedPlanDescription(row.description)) ? (
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
              {module === "tasks-forms" && isCoordinatedPlanDescription(row.description) ? <TogglePillButton color="blue" onPress={() => router.push(`/work-hub/task/${row.id}` as never)}>{t("workPlan.open")}</TogglePillButton> : null}
              {module === "tasks-forms" && row.status !== "completed" && !isCoordinatedPlanDescription(row.description) && (
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
        {!loading && module !== "meetings" && module !== "settings-connections" && module !== "calendar" && module !== "files-notes" && !rows.length && (
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
          ["channels", "calendar", "tasks-forms"].includes(
            module,
          ) && (
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
