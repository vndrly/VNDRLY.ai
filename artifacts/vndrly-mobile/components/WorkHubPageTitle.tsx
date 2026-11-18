import React from "react";
import { Text, View } from "react-native";
import { pageBack } from "@/lib/page-back";

import AskVVoiceIndicator from "@/components/AskVVoiceIndicator";
import BrandTitleRow from "@/components/BrandTitleRow";
import SphereBackButton from "@/components/SphereBackButton";
import { useColors } from "@/hooks/useColors";
import { iosPageLayout } from "@/lib/ios-page-layout";

export default function WorkHubPageTitle({ title, onBack, beforeTitle, afterTitle }: { title: string; onBack?: () => void; beforeTitle?: React.ReactNode; afterTitle?: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ gap: 12 }}>
      {!iosPageLayout && <BrandTitleRow subtitle="iOS Portal" logoTestId="work-hub-company-logo" platformLogoTestId="work-hub-vndrly-logo" />}
      {beforeTitle}
      <View style={{ alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between" }}>
        <View style={{ alignItems: "center", flex: 1, flexDirection: "row", gap: 10, minWidth: 0 }}>
          <SphereBackButton
            onPress={onBack ?? (() => pageBack())}
            size={40}
            testID="work-hub-page-back"
          />
          <Text accessibilityRole="header" numberOfLines={iosPageLayout ? 1 : undefined} style={{ color: colors.text, flexShrink: 1, fontFamily: "Inter_700Bold", fontSize: 20, fontWeight: "700" }}>
            {title}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {iosPageLayout && <BrandTitleRow logoTestId="work-hub-company-logo" platformLogoTestId="work-hub-vndrly-logo" />}
          <AskVVoiceIndicator inline />
        </View>
      </View>
      {afterTitle}
    </View>
  );
}
