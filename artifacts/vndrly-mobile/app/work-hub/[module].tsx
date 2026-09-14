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
import { Assets } from "@/components/implementation-a/Assets";
import { SitePresence } from "@/components/implementation-a/SitePresence";
import { SafetyResponse } from "@/components/implementation-a/SafetyResponse";
import { ImplementationAExports } from "@/components/implementation-a/Exports";
import { OperationsHealth } from "@/components/implementation-a/OperationsHealth";
import WorkHubConversation from "@/components/WorkHubConversation";
import { useMeetingCompanion } from "@/components/MeetingCompanionProvider";
import TogglePillButton from "@/components/TogglePillButton";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api";
import { captureAuthScope } from "@/lib/auth";
import { pickMeetingFile, persistMeetingFileForOffline, uploadMeetingFile, type MeetingFileSource } from "@/lib/meeting-files";
import { mobileOwner, moduleEndpoint } from "@/lib/work-hub-mobile";
import {
  flushNativeWorkHubQueue,
  isOfflineWorkHubFailure,
  queueNativeWorkHubRequest,
  queueNativeWorkHubUpload,
} from "@/lib/work-hub-queue-runtime";

type Row = Record<string, any>;
const titles: Record<string, string> = {
  channels: "Crews & Channels",
  activity: "Activity",
  "managed-crews": "Managed Crews",
  "workforce-coverage": "Workforce Coverage",
  inventory: "Inventory",
  "site-presence": "Site Presence",
  "safety-response": "Safety Response",
  "implementation-exports": "Exports",
  "operations-health": "Operations Health",
  chat: "Chat",
  crews: "Crews",
  calendar: "Calendar",
  "files-notes": "Files & Notes",
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
) {
  return {
    operationId: crypto.randomUUID(),
    owner,
    context: { kind: "organization", id: owner.id },
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
  const module = String(raw ?? "channels");
  const title = titles[module] ?? "Work Hub";
  const owner = mobileOwner(user);
  const activeMembership = user?.availableMemberships?.find(
    (membership) => membership.id === user.activeMembershipId,
  );
  const canManage =
    user?.role === "admin" || activeMembership?.role === "admin";
  const [selectedChannel, setSelectedChannel] = useState<Row | null>(null);
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [meetingFileBusy, setMeetingFileBusy] = useState(false);
  const [meetingFileNotice, setMeetingFileNotice] = useState("");
  const [meetingFileError, setMeetingFileError] = useState("");
  const load = useCallback(
    async (search = query) => {
      setLoading(true);
      setError("");
      try {
        if (user) await flushNativeWorkHubQueue(user);
        setData(await apiFetch(moduleEndpoint(module, search)));
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
    const startsAt = new Date(Date.now() + 60 * 60_000);
    const endsAt = new Date(startsAt.getTime() + 60 * 60_000);
    const targets: Record<string, { path: string; payload: Row }> = {
      channels: { path: "/api/work-hub/channels", payload: { name: draft } },
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
    const body = envelope(owner, target.payload);
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
  if (["managed-crews", "workforce-coverage", "inventory", "site-presence", "safety-response", "implementation-exports", "operations-health"].includes(module))
    return (
      <ScreenSafeArea style={{ backgroundColor: colors.background }}>
        <Stack.Screen options={{ title }} />
        <ScrollView refreshControl={["safety-response", "implementation-exports"].includes(module) ? undefined : <RefreshControl refreshing={loading} onRefresh={() => load()} />} contentContainerStyle={{ padding: 20, gap: 14 }}>
          <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 28, fontWeight: "700" }}>{title}</Text>
          {loading && !data && !["safety-response", "implementation-exports"].includes(module) ? <ActivityIndicator color={colors.primary} /> : null}
          {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
          {module === "managed-crews" && <ManagedCrews sponsorships={data?.sponsorships ?? []} />}
          {module === "workforce-coverage" && <WorkforceCoverage gaps={data?.gaps ?? []} />}
          {module === "inventory" && <Assets assets={data?.assets ?? []} />}
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
          <Text
            accessibilityRole="header"
            style={{ color: colors.text, fontSize: 28, fontWeight: "700" }}
          >
            Calls
          </Text>
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
        <Text
          accessibilityRole="header"
          style={{ color: colors.text, fontSize: 28, fontWeight: "700" }}
        >
          {title}
        </Text>
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
        {owner &&
          canManage &&
          ["channels", "calendar", "tasks-forms", "meetings"].includes(
            module,
          ) && (
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
              {["channels", "chat"].includes(module) && (
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
        {!loading && module !== "settings-connections" && !rows.length && (
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
