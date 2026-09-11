import React from "react";
import { Stack, useLocalSearchParams } from "expo-router";
import MeetingWorkspace from "@/components/meeting-workspace";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import { useColors } from "@/hooks/useColors";
import { useTranslation } from "react-i18next";

export default function WorkHubMeetingScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const { occurrenceId: rawOccurrenceId } = useLocalSearchParams<{ occurrenceId: string }>();
  const occurrenceId = String(rawOccurrenceId ?? "");
  return <ScreenSafeArea includeTopGap={false} style={{ backgroundColor: "#3a3d42" }}>
    <Stack.Screen options={{ title: t("meetingWorkspace.title", { defaultValue: "Meeting" }), headerStyle: { backgroundColor: colors.card } }} />
    <MeetingWorkspace occurrenceId={occurrenceId} />
  </ScreenSafeArea>;
}
