import { Stack, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api";
import { mobileOwner, moduleEndpoint } from "@/lib/work-hub-mobile";

type Row = Record<string, any>;
const titles: Record<string, string> = {
  channels: "Channels",
  calendar: "Calendar",
  "files-notes": "Files & Notes",
  "tasks-forms": "Tasks & Forms",
  meetings: "Meetings",
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
  const colors = useColors();
  const { user } = useAuth();
  const { module: raw } = useLocalSearchParams<{ module: string }>();
  const module = String(raw ?? "channels");
  const title = titles[module] ?? "Work Hub";
  const owner = mobileOwner(user);
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const load = useCallback(
    async (search = query) => {
      setLoading(true);
      setError("");
      try {
        setData(await apiFetch(moduleEndpoint(module, search)));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load Work Hub");
      } finally {
        setLoading(false);
      }
    },
    [module, query],
  );
  useEffect(() => {
    void load("");
  }, [module]);
  const rows = useMemo<Row[]>(() => {
    if (Array.isArray(data)) return data;
    if (module === "calendar")
      return [
        ...(data?.shifts ?? []).map((x: Row) => ({ ...x.item, kind: "Shift" })),
        ...(data?.tasks ?? []).map((x: Row) => ({ ...x.item, kind: "Task" })),
        ...(data?.meetings ?? []).map((x: Row) => ({
          ...x.occurrence,
          title: x.meeting.title,
          kind: "Meeting",
        })),
      ];
    if (module === "meetings")
      return (data?.meetings ?? []).map((x: Row) => ({
        ...x.occurrence,
        title: x.meeting.title,
        agenda: x.meeting.agenda,
        kind: "Meeting",
      }));
    return [];
  }, [data, module]);
  const complete = async (row: Row) => {
    if (!owner) return;
    try {
      await apiFetch(`/api/work-hub/tasks/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify(
          envelope(owner, { status: "completed" }, row.version),
        ),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update task");
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
    try {
      await apiFetch(target.path, {
        method: "POST",
        body: JSON.stringify(envelope(owner, target.payload)),
      });
      setDraft("");
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not create Work Hub record",
      );
    }
  };
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
                padding: 12,
              }}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => load(query)}
              style={{
                backgroundColor: colors.primary,
                borderRadius: 10,
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
        {owner &&
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
                  padding: 12,
                }}
              />
              <Pressable
                accessibilityRole="button"
                onPress={quickCreate}
                style={{
                  backgroundColor: colors.primary,
                  borderRadius: 10,
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
        {rows.map((row) => (
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
                }}
              >
                <Text
                  style={{ color: colors.primaryForeground, fontWeight: "700" }}
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
          ["channels", "calendar", "tasks-forms", "meetings"].includes(
            module,
          ) && (
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
              iOS supports quick creation and participant outcomes. Advanced
              template builders, bulk assignments, announcement delivery, and
              approval monitoring are available in the web administration view.
            </Text>
          )}
      </ScrollView>
    </ScreenSafeArea>
  );
}
