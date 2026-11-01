import React from "react";
import { ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import EquipmentWorkbench from "@/components/EquipmentWorkbench";
import { useAuth } from "@/hooks/use-auth";
import { captureAuthScope } from "@/lib/auth";

export default function EquipmentScreen() {
  const { assetId } = useLocalSearchParams<{ assetId?: string }>(), { user } = useAuth(), { i18n } = useTranslation();
  return <ScreenSafeArea><ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}><WorkHubPageTitle title={i18n.language.startsWith("es") ? "Equipo" : "Equipment"} /><EquipmentWorkbench key={`${user?.id}:${user?.activeMembershipId}:${captureAuthScope().generation}`} initialAssetId={assetId} /></ScrollView></ScreenSafeArea>;
}
