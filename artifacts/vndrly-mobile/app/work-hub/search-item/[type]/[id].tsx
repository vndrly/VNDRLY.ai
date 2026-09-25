import React from "react";
import { Stack, useLocalSearchParams } from "expo-router";
import { ScrollView } from "react-native";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import { WorkHubSearchItem } from "@/components/work-hub/WorkHubSearchItem";
import { useColors } from "@/hooks/useColors";

export default function SearchItemScreen() {
  const { type, id } = useLocalSearchParams<{ type: string; id: string }>();
  const colors = useColors();
  return <ScreenSafeArea style={{ backgroundColor: colors.background }}>
    <Stack.Screen options={{ title: "Search result" }} />
    <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
      <WorkHubPageTitle title="Search result" />
      <WorkHubSearchItem subjectType={String(type ?? "")} itemId={String(id ?? "")} />
    </ScrollView>
  </ScreenSafeArea>;
}
