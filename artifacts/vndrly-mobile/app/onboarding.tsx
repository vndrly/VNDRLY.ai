import React, { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import {
  OnboardingText as Text,
  OnboardingInput as TextInput,
} from "@/components/OnboardingControls";
import { useTranslation } from "react-i18next";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import TogglePillButton from "@/components/TogglePillButton";
import NativeOnboarding from "@/components/NativeOnboarding";
import NativeFieldOnboarding from "@/components/NativeFieldOnboarding";
import { useAuth } from "@/hooks/use-auth";
export default function OnboardingScreen() {
  const { user, activeMembershipId, availableMemberships } = useAuth(),
    { t } = useTranslation();
  const params = useLocalSearchParams<{ token?: string }>();
  const [entered, setEntered] = useState(""),
    [invite, setInvite] = useState(
      typeof params.token === "string" ? params.token : "",
    );
  const membership = availableMemberships.find(
    (item) => item.id === activeMembershipId,
  );
  const organization =
    user?.role === "vendor" && user.vendorId
      ? { type: "vendor" as const, id: user.vendorId }
      : user?.role === "partner" && user.partnerId
        ? { type: "partner" as const, id: user.partnerId }
        : null;
  return (
    <ScreenSafeArea style={{ flex: 1 }}>
      {invite ? (
        <NativeFieldOnboarding key={invite} token={invite} />
      ) : organization && membership?.role === "admin" ? (
        <NativeOnboarding
          key={`${user?.id}:${activeMembershipId}:${organization.type}:${organization.id}`}
          organization={organization}
        />
      ) : (
        <View style={{ padding: 18, gap: 16 }}>
          <Text>{t("onboardingNative.inviteRequired")}</Text>
          <TextInput
            accessibilityLabel={t("onboardingNative.inviteToken")}
            autoCapitalize="none"
            autoCorrect={false}
            value={entered}
            onChangeText={setEntered}
            secureTextEntry
          />
          <TogglePillButton
            color="blue"
            disabled={entered.trim().length < 16}
            onPress={() => setInvite(entered.trim())}
          >
            {t("onboardingNative.openInvite")}
          </TogglePillButton>
          <TogglePillButton color="blue" onPress={() => router.push("/login")}>
            {t("onboardingNative.signIn")}
          </TogglePillButton>
        </View>
      )}
    </ScreenSafeArea>
  );
}
