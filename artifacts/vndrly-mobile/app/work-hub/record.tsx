import React, { useEffect, useState } from "react";
import { ScrollView, Text, ActivityIndicator } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import TogglePillButton from "@/components/TogglePillButton";
import {
  loadNotificationDestination,
  type NotificationDestinationContent,
} from "@/lib/notification-destination";
import { useColors } from "@/hooks/useColors";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import{useAuth}from"@/hooks/use-auth";
export default function DailyRecord() {
  const {user,activeMembershipId}=useAuth();
  const { id, kind } = useLocalSearchParams<{ id: string; kind: string }>(),
    c = useColors(),
    [data, setData] = useState<NotificationDestinationContent | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const scope = captureAuthScope();
    let alive = true;
    setData(null);
    setError("");
    if (!["task","shift"].includes(kind) || !id || !/^[0-9a-f-]{36}$/i.test(id)) {
      setError("Record unavailable");
      return;
    }
    void loadNotificationDestination({ kind:kind as "task"|"shift", id })
      .then((value) => {
        if (alive && isAuthScopeCurrent(scope)) setData(value);
      })
      .catch(() => {
        if (alive && isAuthScopeCurrent(scope))
          setError(
            "This record is no longer available in your current company.",
          );
      });
    return () => {
      alive = false;
    };
  }, [id, kind,user?.id,activeMembershipId]);
  return (
    <ScreenSafeArea>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        <WorkHubPageTitle title="My Work" />
        {error ? (
          <Text accessibilityRole="alert" style={{ color: c.foreground }}>
            {error}
          </Text>
        ) : !data ? (
          <ActivityIndicator />
        ) : (
          <>
            <Text
              style={{ color: c.foreground, fontSize: 20, fontWeight: "700" }}
            >
              {data.title}
            </Text>
            {data.lines.map((line, index) => (
              <Text key={index} style={{ color: c.foreground }}>
                {line}
              </Text>
            ))}
            <TogglePillButton
              compactOnTablet
              onPress={() => router.push(kind==="shift"?"/work-hub/calendar":"/work-hub/tasks-forms")}
            >
              {kind==="shift"?"Open Calendar":"Open Tasks & Forms actions"}
            </TogglePillButton>
          </>
        )}
      </ScrollView>
    </ScreenSafeArea>
  );
}
