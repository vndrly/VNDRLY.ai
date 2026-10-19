import React from "react";
import { ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { gateDailyBillingCopy } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import BrandTitleRow from "@/components/BrandTitleRow";
import SphereBackButton from "@/components/SphereBackButton";
import GateDailyBillingPanel from "@/components/GateDailyBillingPanel";
export default function GateBillingScreen() {
  const { user, activeMembershipId } = useAuth(),
    colors = useColors(),
    { i18n } = useTranslation();
  return (
    <ScreenSafeArea>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}
      >
        <BrandTitleRow
          subtitle="iOS Portal"
          logoTestId="gate-billing-brand-logo"
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <SphereBackButton
            onPress={() =>
              router.canGoBack()
                ? router.back()
                : router.replace("/(tabs)/gate-history" as never)
            }
            size={40}
          />
          <Text
            accessibilityRole="header"
            style={{
              color: colors.foreground,
              fontWeight: "700",
              fontSize: 22,
            }}
          >
            {gateDailyBillingCopy("Gate daily billing", i18n.language)}
          </Text>
        </View>
        <GateDailyBillingPanel
          scopeKey={`${user?.id}:${activeMembershipId}:${user?.role}`}
        />
      </ScrollView>
    </ScreenSafeArea>
  );
}
