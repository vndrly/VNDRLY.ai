import React from "react";
import { useTranslation } from "react-i18next";
import { View, Text, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import {
  useDailySummary,
  pendingTasks,
  myWorkItems,
  pendingSafety,
  attentionNotices,
} from "@/lib/daily-workspace";
import TogglePillButton from "./TogglePillButton";
import { openNotificationDestination } from "@/lib/notification-deep-links";
export default function DailyWorkPanel({
  mode,
}: {
  mode: "attention" | "safety" | "my-work";
}) {
  const { t } = useTranslation();
  const c = useColors(),
    q = useDailySummary(),
    s = q.sources;
  const card = {
    borderWidth: 2,
    borderColor: c.primary,
    borderRadius: 14,
    padding: 14,
    gap: 8,
    backgroundColor: c.card,
  };
  const text = { color: c.foreground };
  const row = (
    key: string,
    title: string,
    status: string,
    onPress: () => void,
  ) => (
    <View key={key} style={card}>
      <Text style={{ ...text, fontWeight: "700" }}>{title}</Text>
      <Text style={{ color: c.mutedForeground }}>{status}</Text>
      <TogglePillButton compactOnTablet onPress={onPress}>
        Open record
      </TogglePillButton>
    </View>
  );
  return (
    <View style={{ gap: 12 }}>
      {q.isLoading && <ActivityIndicator />}
      {q.isError && (
        <Text accessibilityRole="alert" style={text}>
          Some sources could not load. Available records remain visible.
        </Text>
      )}
      {mode === "safety" && (
        <TogglePillButton
          compactOnTablet
          solid
          onPress={() => router.push("/safety-report")}
        >
          Report a safety incident
        </TogglePillButton>
      )}
      {mode === "attention" && (
        <>
          <Text style={{ color: c.mutedForeground }}>
            Reading a notification does not acknowledge or resolve its work.
            Current status is checked in the source record.
          </Text>
          <TogglePillButton
            compactOnTablet
            onPress={() => router.push("/notifications")}
          >
            Open notification inbox
          </TogglePillButton>
        </>
      )}
      {s &&
        (mode === "safety" || mode === "attention") &&
        pendingSafety(s.safety ?? []).map((item) =>
          row(
            "safety-" + item.id,
            item.eventNumber
              ? item.eventNumber + " · " + item.title
              : item.title,
            item.status,
            () =>
              router.push({
                pathname: "/safety-event/[id]",
                params: { id: String(item.id) },
              }),
          ),
        )}
      {s && mode === "safety" && (
        <>
          <Text style={text}>Report history</Text>
          {(s.safety ?? [])
            .filter((item) => !pendingSafety([item]).length)
            .map((item) =>
              row("history-" + item.id, item.title, item.status, () =>
                router.push({
                  pathname: "/safety-event/[id]",
                  params: { id: String(item.id) },
                }),
              ),
            )}
        </>
      )}
      {s &&
        mode === "attention" &&
        pendingTasks(s.tasks ?? []).map((item) =>
          row("task-" + item.id, item.title, item.status, () =>
            router.push({
              pathname: "/work-hub/record" as never,
              params: { kind: "task", id: item.id },
            }),
          ),
        )}
      {s &&
        mode === "attention" &&
        attentionNotices(s).map((item) =>
          row(
            "notice-" + item.id,
            item.title,
            item.isRead
              ? "Read · review current record status"
              : "Unread notification",
            () => {
              void openNotificationDestination(item, router);
            },
          ),
        )}
      {s && mode === "my-work" && myWorkItems(s).map(item => row(`${item.kind}-${item.id}`, `${t(`myWork.kind_${item.kind}`)} · ${item.title}`, item.status, () => {
        if (item.kind === "ticket") router.push(`/ticket/${item.id}` as never);
        else if (item.kind === "run") router.push(`/fleet-run/${item.id}` as never);
        else router.push({pathname:"/work-hub/record" as never,params:{kind:item.kind,id:item.id}});
      }))}
      {s && mode === "my-work" && (
        <TogglePillButton
          compactOnTablet
          onPress={() => router.push("/work-hub/calendar")}
        >
          View shifts and scheduled work
        </TogglePillButton>
      )}
      {s && (s.notificationLimited || s.safetyLimited) && (
        <Text style={{ color: c.mutedForeground }}>
          Showing the latest available records. Counts cover this loaded view;
          the inbox and report history contain more records.
        </Text>
      )}
      {s && mode === "attention" && q.data?.attentionCount === 0 && (
        <Text style={text}>No items currently need attention.</Text>
      )}
      {s && mode === "safety" && !s.safety?.length && (
        <Text style={text}>No authorized safety reports in this view.</Text>
      )}
    </View>
  );
}
