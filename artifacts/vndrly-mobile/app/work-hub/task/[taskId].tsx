import React from "react";
import { Stack, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPlanDetail from "@/components/work-hub/WorkHubPlanDetail";
export default function WorkHubTaskScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>(),
    { t } = useTranslation();
  return (
    <ScreenSafeArea
      includeTopGap={false}
      style={{ backgroundColor: "#3a3d42" }}
    >
      <Stack.Screen options={{ title: t("workPlan.title") }} />
      <WorkHubPlanDetail taskId={String(taskId ?? "")} />
    </ScreenSafeArea>
  );
}
