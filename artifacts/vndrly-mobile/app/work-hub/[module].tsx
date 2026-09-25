import { Stack, router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import WorkHubCalls from "@/components/WorkHubCalls";
import { ManagedCrews } from "@/components/implementation-a/ManagedCrews";
import { WorkforceCoverage } from "@/components/implementation-a/WorkforceCoverage";
import { FilesInventory } from "@/components/work-hub/FilesInventory";
import { SitePresence } from "@/components/implementation-a/SitePresence";
import { SafetyResponse } from "@/components/implementation-a/SafetyResponse";
import { ImplementationAExports } from "@/components/implementation-a/Exports";
import { OperationsHealth } from "@/components/implementation-a/OperationsHealth";
import WorkHubConversation from "@/components/WorkHubConversation";
import { useMeetingCompanion } from "@/components/MeetingCompanionProvider";
import TogglePillButton from "@/components/TogglePillButton";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import WorkHubShiftCalendar from "@/components/WorkHubShiftCalendar";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api";
import { captureAuthScope } from "@/lib/auth";
import { pickMeetingFile, persistMeetingFileForOffline, uploadMeetingFile, type MeetingFileSource } from "@/lib/meeting-files";
import { loadFilesInventoryData, mobileOwner, moduleEndpoint } from "@/lib/work-hub-mobile";
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
  return {
    operationId: crypto.randomUUID(),
    owner,
    context,
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    payload,
  };
}

export default function WorkHubModuleScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const { user } = useAuth();
  const meetingCompanion = useMeetingCompanion();
  const { module: raw } = useLocalSearchParams<{ module: string }>();
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
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [calendarGateShift, setCalendarGateShift] = useState(false);
  const [gateSites, setGateSites] = useState<Row[]>([]);
  const [gateStations, setGateStations] = useState<Row[]>([]);
  const [gateSiteId, setGateSiteId] = useState("");
  const [gateStationId, setGateStationId] = useState("");
  const [requiredGatekeepers, setRequiredGatekeepers] = useState("1");
  const [workStartPolicy, setWorkStartPolicy] = useState<"on_site" | "paid_travel">("on_site");
  const [meetingFileBusy, setMeetingFileBusy] = useState(false);
  const [meetingFileNotice, setMeetingFileNotice] = useState("");
  const [meetingFileError, setMeetingFileError] = useState("");
  const [chatGroups, setChatGroups] = useState<Row[]>([]);
  const [chatPeople, setChatPeople] = useState<Row[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [chatActionBusy, setChatActionBusy] = useState(false);
  const [chatActionNotice, setChatActionNotice] = useState("");
  const load = useCallback(
    async (search = query) => {
      setLoading(true);
      setError("");
      try {
        if (user) await flushNativeWorkHubQueue(user);
        if (module === "files-notes") {
          const currentOwner = mobileOwner(user);
          if (!currentOwner) throw new Error(t("filesInventory.chooseCompany"));
          setData(await loadFilesInventoryData(currentOwner, apiFetch));
        } else setData(await apiFetch(moduleEndpoint(module, search)));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load Work Hub");
      } finally {
        setLoading(false);
      }
    },
    [module, query, user],
  );
  useEffect(() => {
    if (module !== "calls" && module !== "safety-response" && module !== "implementation-exports") void load("");
  }, [module]);
  useEffect(() => {
    if (module !== "calendar" || !canManage) return;
    apiFetch<{ sites: Row[] }>("/api/gate-change-over/sites")
      .then((result) => setGateSites(result.sites ?? []))
      .catch(() => setGateSites([]));
  }, [canManage, module]);
  useEffect(() => {
    if (!gateSiteId) {
      setGateStations([]);
      return;
    }
    apiFetch<{ stations: Row[] }>(`/api/gate-change-over/stations?siteId=${gateSiteId}`)
      .then((result) => setGateStations(result.stations ?? []))
      .catch(() => setGateStations([]));
  }, [gateSiteId]);
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
          kind: "Meeting",
        })),
      ];
    if (module === "meetings")
      return (data?.meetings ?? []).map((x: Row) => ({
        ...(x.occurrence ?? x.item?.occurrence),
        title: (x.meeting ?? x.item?.meeting)?.title,
        agenda: (x.meeting ?? x.item?.meeting)?.agenda,
        kind: "Meeting",
      }));
    if (module === "search") return data?.results ?? [];
    return [];
  }, [data, module]);
  const complete = async (row: Row) => {
    if (!owner) return;
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
    if (
      module === "calendar" &&
      calendarGateShift &&
      (!gateSiteId || !gateStationId || Number(requiredGatekeepers) < 1)
    ) {
      setError("Choose the Gate site, station, and required staffing first.");
      return;
    }
    const startsAt = new Date(Date.now() + 60 * 60_000);
    const endsAt = new Date(startsAt.getTime() + 60 * 60_000);
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
      calendar: {
        path: "/api/work-hub/shifts",
        payload: {
          title: draft,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          open: false,
          assigneeUserIds: [],
          qualificationCodes: [],
          ...(calendarGateShift ? {
            siteLocationId: Number(gateSiteId),
            gateStationId,
            requiredStaffCount: Number(requiredGatekeepers),
            workStartPolicy,
          } : {}),
        },
      },
      meetings: {
        path: "/api/work-hub/meetings",
        payload: {
          title: draft,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          recordingAllowed: false,
          participantUserIds: [],
        },
      },
    };
    const target = targets[module];
    if (!target) return;
    const body = module === "channels"
      ? { operationId: crypto.randomUUID(), owner, name: draft.trim() }
      : envelope(
          owner,
          target.payload,
          undefined,
          module === "calendar" && calendarGateShift
            ? { kind: "gate", id: Number(gateSiteId) }
            : undefined,
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
              operationId: crypto.randomUUID(),
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
          {module === "implementation-exports" && owner && <ImplementationAExports owner={owner} />}
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
        {module === "files-notes" && owner && data?.capabilities && <FilesInventory owner={owner} capabilities={data.capabilities} files={data.files ?? []} notes={data.notes ?? []} assets={data.assets ?? []} channels={data.channels ?? []} onRefresh={() => load()} />}
        {module === "files-notes" && !loading && data && !data.capabilities && <Text style={{ color: colors.mutedForeground }}>{t("filesInventory.noAccess")}</Text>}
        {module === "calendar" ? <WorkHubShiftCalendar items={rows} /> : null}
        {module === "search" && (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              accessibilityLabel="Search Work Hub"
              value={query}
              onChangeText={setQuery}
              placeholder="Search authorized records"
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
              onPress={() => load(query)}
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
                Search
              </Text>
            </Pressable>
          </View>
        )}
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
        {module === "chat" && !selectedChannel && (
          <View accessibilityLabel="New Chat" style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 12, padding: 16, gap: 12, backgroundColor: colors.card }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>New Chat</Text>
            <Text style={{ color: colors.text, fontWeight: "700" }}>Select Group</Text>
            <View style={{ gap: 8 }}>
              {chatGroups.map((group) => {
                const selected = selectedGroupId === group.id;
                return (
                  <Pressable
                    key={group.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Select group ${group.name}`}
                    onPress={() => {
                      setSelectedGroupId(group.id);
                      setSelectedPersonId("");
                    }}
                    style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 10, minHeight: 44, padding: 12, justifyContent: "center", backgroundColor: selected ? colors.primary : colors.background }}
                  >
                    <Text style={{ color: selected ? colors.primaryForeground : colors.text, fontWeight: "600" }}>{group.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={{ color: colors.text, fontWeight: "700" }}>Select Person</Text>
            <View style={{ gap: 8 }}>
              {chatPeople.map((person) => {
                const selected = selectedPersonId === String(person.id);
                const detail = [person.organizationName, person.role].filter(Boolean).join(" · ");
                return (
                  <Pressable
                    key={person.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Select person ${person.displayName}`}
                    onPress={() => {
                      setSelectedPersonId(String(person.id));
                      setSelectedGroupId("");
                    }}
                    style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 10, minHeight: 44, padding: 12, justifyContent: "center", backgroundColor: selected ? colors.primary : colors.background }}
                  >
                    <Text style={{ color: selected ? colors.primaryForeground : colors.text, fontWeight: "600" }}>{person.displayName}</Text>
                    {!!detail && <Text style={{ color: selected ? colors.primaryForeground : colors.mutedForeground, fontSize: 12 }}>{detail}</Text>}
                  </Pressable>
                );
              })}
            </View>
            <TogglePillButton
              color="brand"
              disabled={(!selectedGroupId && !selectedPersonId) || chatActionBusy}
              loading={chatActionBusy}
              accessibilityLabel={selectedGroupId ? "Start Chat" : "Send Invite"}
              onPress={() => void startChat()}
            >
              {selectedGroupId ? "Start Chat" : "Send Invite"}
            </TogglePillButton>
            {!!chatActionNotice && <Text accessibilityLiveRegion="polite" style={{ color: colors.text, fontWeight: "700" }}>{chatActionNotice}</Text>}
          </View>
        )}
        {owner &&
          canManage &&
          ["channels", "calendar", "tasks-forms", "meetings"].includes(
            module,
          ) && (
            <View style={{ gap: 10 }}>
              {module === "calendar" && (
                <View accessibilityLabel="Gate shift scheduling" style={{ borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 12, gap: 10, backgroundColor: colors.card }}>
                  <Text style={{ color: colors.text, fontWeight: "700" }}>Shift type</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    <TogglePillButton color="brand" solid={!calendarGateShift} accessibilityLabel="Standard shift" onPress={() => setCalendarGateShift(false)}>Standard</TogglePillButton>
                    <TogglePillButton color="brand" solid={calendarGateShift} accessibilityLabel="Gate shift" onPress={() => setCalendarGateShift(true)}>Gate shift</TogglePillButton>
                  </View>
                  {calendarGateShift && <>
                    <Text style={{ color: colors.text, fontWeight: "700" }}>Gate site</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {gateSites.map((site) => <TogglePillButton key={site.id} color="brand" solid={gateSiteId === String(site.id)} accessibilityLabel={`Gate site ${site.name}`} onPress={() => { setGateSiteId(String(site.id)); setGateStationId(""); }}>{site.name}</TogglePillButton>)}
                    </View>
                    <Text style={{ color: colors.text, fontWeight: "700" }}>Gate station</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {gateStations.map((station) => <TogglePillButton key={station.id} color="brand" solid={gateStationId === station.id} accessibilityLabel={`Gate station ${station.name}`} onPress={() => setGateStationId(station.id)}>{station.name}</TogglePillButton>)}
                    </View>
                    <TextInput accessibilityLabel="Required gatekeepers" keyboardType="number-pad" value={requiredGatekeepers} onChangeText={setRequiredGatekeepers} placeholder="Required gatekeepers" placeholderTextColor={colors.mutedForeground} style={{ color: colors.text, borderWidth: 2, borderColor: colors.primary, borderRadius: 999, minHeight: 44, paddingHorizontal: 14 }} />
                    <Text style={{ color: colors.text, fontWeight: "700" }}>Work start policy</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      <TogglePillButton color="brand" solid={workStartPolicy === "on_site"} accessibilityLabel="Start work on site" onPress={() => setWorkStartPolicy("on_site")}>On-site start</TogglePillButton>
                      <TogglePillButton color="brand" solid={workStartPolicy === "paid_travel"} accessibilityLabel="Paid travel starts work" onPress={() => setWorkStartPolicy("paid_travel")}>Paid travel</TogglePillButton>
                    </View>
                  </>}
                </View>
              )}
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
        {!selectedChannel &&
          rows.map((row) => (
            <View
              key={row.id}
              style={{
                borderWidth: 1,
                borderColor: colors.border,
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
              {row.description || row.agenda || row.body ? (
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
              {module === "chat" && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setSelectedChannel(row)}
                >
                  <Text style={{ color: colors.primary, padding: 10, minHeight: 44, textAlignVertical: "center" }}>
                    Open conversation
                  </Text>
                </Pressable>
              )}
              {module === "tasks-forms" && row.status !== "completed" && (
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
        {!loading && module !== "settings-connections" && module !== "calendar" && module !== "files-notes" && !rows.length && (
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
          ["channels", "calendar", "tasks-forms", "meetings"].includes(
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
