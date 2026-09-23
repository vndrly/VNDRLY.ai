import React from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import AskVVoiceIndicator from "@/components/AskVVoiceIndicator";
import BrandTitleRow from "@/components/BrandTitleRow";
import SphereBackButton from "@/components/SphereBackButton";
import { useColors } from "@/hooks/useColors";

export default function WorkHubPageTitle({ title }: { title: string }) {
  const colors = useColors();
  return (
    <View style={{ gap: 12 }}>
      <BrandTitleRow subtitle="iOS Portal" logoTestId="work-hub-company-logo" platformLogoTestId="work-hub-vndrly-logo" />
      <View style={{ alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between" }}>
        <View style={{ alignItems: "center", flex: 1, flexDirection: "row", gap: 10, minWidth: 0 }}>
          <SphereBackButton
            onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/change-over" as never)}
            size={40}
            testID="work-hub-page-back"
          />
          <Text accessibilityRole="header" style={{ color: colors.text, flexShrink: 1, fontSize: 26, fontWeight: "700" }}>
            {title}
          </Text>
        </View>
        <AskVVoiceIndicator inline />
      </View>
    </View>
  );
}
