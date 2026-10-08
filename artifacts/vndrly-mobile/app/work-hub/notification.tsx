import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import { useColors } from "@/hooks/useColors";
import {
  cancelNotificationOpen,
  confirmNotificationRendered,
  getNotificationOpenRequest,
} from "@/lib/notification-deep-links";
import {
  loadNotificationDestination,
  type NotificationDestinationContent,
} from "@/lib/notification-destination";
import { syncAppIconBadge } from "@/lib/notificationBadge";
import { captureAuthScope, subscribeToken, subscribeUser } from "@/lib/auth";
import TogglePillButton from "@/components/TogglePillButton";
import { useFleetCopy } from "@/lib/fleet-copy";
import WorkHubConversation from "@/components/WorkHubConversation";
import NativeShiftResponse from "@/components/work-hub/NativeShiftResponse";
import { isAuthScopeCurrent } from "@/lib/auth";
import type { NotificationTarget } from "@/lib/notification-destination";

function subscribeAuthScope(listener: () => void) {
  const user = subscribeUser(listener);
  const token = subscribeToken(listener);
  return () => {
    user();
    token();
  };
}
const authGeneration = () => captureAuthScope().generation;

export default function NotificationDestinationScreen() {
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const colors = useColors();
  const { t } = useTranslation();
  const fleetCopy=useFleetCopy();
  const generation = useSyncExternalStore(subscribeAuthScope, authGeneration);
  const [loaded, setLoaded] = useState<{
    requestId: string;
    generation: number;
    record: NotificationDestinationContent;
    target: NotificationTarget;
  } | null>(null);
  const invalidated = loaded !== null && loaded.generation !== generation;
  // Guard during render, even after acknowledgement removes the transient request.
  const record =
    loaded?.requestId === requestId && !invalidated ? loaded.record : null;
  const mountedRequest = useRef<{ requestId: string } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [conversation, setConversation] = useState<Record<string, any> | null>(null);
  useEffect(() => {
    let active = true;
    const mount = { requestId };
    mountedRequest.current = mount;
    setLoaded(null);
    setConversation(null);
    setUnavailable(false);
    const request = getNotificationOpenRequest(requestId);
    if (!request) setUnavailable(true);
    else {
      void request.completion.then((result) => {
        if (active && result === "unavailable") {
          setLoaded(null);
          setUnavailable(true);
        }
      });
      void loadNotificationDestination(request.target)
        .then((value) => {
          if (active && getNotificationOpenRequest(requestId) === request)
            setLoaded({
              requestId,
              generation: request.scope.generation,
              record: value,
              target: request.target,
            });
          else if (active) setUnavailable(true);
        })
        .catch(() => {
          if (active) {
            setUnavailable(true);
            cancelNotificationOpen(requestId);
          }
        });
    }
    return () => {
      active = false;
      // React can replay mount effects; only cancel after an actual departure.
      queueMicrotask(() => {
        if (
          mountedRequest.current === mount ||
          mountedRequest.current?.requestId !== requestId
        )
          cancelNotificationOpen(requestId);
      });
    };
  }, [requestId]);
  useEffect(() => {
    if (!invalidated) return;
    setLoaded(null);
    setUnavailable(true);
    cancelNotificationOpen(requestId);
  }, [invalidated, requestId]);
  useEffect(() => {
    if (!record) return;
    void confirmNotificationRendered(requestId).then((result) => {
      if (result === "opened") void syncAppIconBadge();
      else if (getNotificationOpenRequest(requestId)) {
        setLoaded(null);
        setUnavailable(true);
      }
    });
  }, [record, requestId]);
  const title =
    record?.kind === "fleet" ? fleetCopy("Fleet") : record?.kind === "credential"
      ? t("notifications.categories.compliance", { defaultValue: "Compliance" })
      : record?.kind === "handoff"
        ? t("notifications.categories.handoffs", { defaultValue: "Handoffs" })
        : t("workHub.title", { defaultValue: "Work Hub" });
  return (
    <ScreenSafeArea style={{ backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <WorkHubPageTitle title={title} />
        {unavailable || invalidated ? (
          <Text
            accessibilityRole="alert"
            style={{ color: colors.mutedForeground }}
          >
            {t("notifications.destinationUnavailable", {
              defaultValue:
                "This notification's destination is no longer available.",
            })}
          </Text>
        ) : record ? (
          <View
            testID={`notification-destination-${record.subjectId}`}
            style={{
              backgroundColor: colors.card,
              borderColor: colors.primary,
              borderWidth: 2,
              borderRadius: 12,
              padding: 16,
              gap: 12,
            }}
          >
            {record.title ? (
              <Text
                accessibilityRole="header"
                style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}
              >
                {record.title}
              </Text>
            ) : null}
            {record.lines.map((line, index) => (
              <Text key={index} style={{ color: colors.text }}>
                {record.kind==="fleet"?fleetCopy(line):line}
              </Text>
            ))}
            {record.kind === "shift" && loaded?.target.kind === "shift" ? <NativeShiftResponse key={`${generation}.${loaded.target.id}`} shiftId={loaded.target.id} /> : null}
            {record.kind==="fleet"&&<TogglePillButton onPress={()=>router.push({pathname:"/fleet-run/[id]",params:{id:record.subjectId}} as never)}>{fleetCopy("Open exact Fleet run")}</TogglePillButton>}
            {record.kind === "channel" && loaded?.target.kind === "channel" ? <TogglePillButton onPress={() => {
              const target = loaded.target, scope = captureAuthScope();
              void loadNotificationDestination({ kind: "channel", id: target.id }).then(value => {
                if (isAuthScopeCurrent(scope) && value.channel?.id === target.id) setConversation({ ...value.channel, ...(record.replyMessage ? { initialReplyMessage: record.replyMessage } : {}) });
              }).catch(() => setUnavailable(true));
            }}>{t("nativeNotifications.reply")}</TogglePillButton> : null}
            {conversation && !invalidated ? <WorkHubConversation channel={conversation} onClose={() => setConversation(null)} /> : null}
          </View>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </ScrollView>
    </ScreenSafeArea>
  );
}
