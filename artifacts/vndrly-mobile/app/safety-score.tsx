import React from "react";
import { router, Stack } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import InPageHeader from "@/components/InPageHeader";
import LayeredPillButton from "@/components/LayeredPillButton";
import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import { fetchSafetyMetrics, fetchSafetyMaturity } from "@/lib/safety-api";

export default function SafetyScoreScreen() {
  const { t } = useTranslation();
  const { user, activeMembershipId } = useAuth();
  const colors = useColors();
  const brand = useBrand();
  const metrics = useQuery({ queryKey: ["safety-metrics"], queryFn: fetchSafetyMetrics });
  const readiness = useQuery({ queryKey: ["safety-maturity", user?.id, activeMembershipId], queryFn: fetchSafetyMaturity });
  const card = { backgroundColor: colors.card, borderColor: brand.primary, borderWidth: 2, borderRadius: 12, padding: 16, gap: 10 };
  const text = { color: colors.foreground };
  return <View style={{ flex: 1 }}>
    <Stack.Screen options={{ headerShown: false }} />
    <InPageHeader title={t("safetyMaturity.title")} onBack={() => router.canGoBack() ? router.back() : router.replace("/work-hub/safety")} />
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <View style={card}>
        <Text style={{ ...text, fontSize: 18, fontWeight: "600" }}>{t("safetyMaturity.title")}</Text>
        <Text style={{ ...text, fontSize: 36, fontWeight: "700" }}>{readiness.data ? `${readiness.data.score} / 100` : readiness.isError ? t("safety.scoreDetails.unavailable") : t("safety.scoreDetails.loading")}</Text>
        {readiness.data&&<View><Text style={text}>VNDRLY base: {readiness.data.score} / 100 · Vendor Augmented bonus: {(readiness.data.bonusScore ?? 0).toFixed(2)} / 10</Text><Text style={text}>Combined: {(readiness.data.combinedScore??readiness.data.score).toFixed(2)} / 110</Text></View>}
        <Text style={text}>{t("safetyMaturity.separate")}</Text>
        {metrics.data && <Text style={text}>{t("safety.scoreDetails.events", { count: metrics.data.openEventCount, hipo: metrics.data.openHipoCount })}</Text>}
        {readiness.data?.incomplete && <Text style={text}>{t("safetyMaturity.incomplete")}</Text>}
        <LayeredPillButton onPress={() => router.push("/safety-my-reports")}><Text style={text}>{t("safety.scoreDetails.reviewEvents")}</Text></LayeredPillButton>
      </View>
      {readiness.data?.categories.map(category => <View key={category.id} style={card}>
        <Text style={{ ...text, fontWeight: "600" }}>{t(`safetyMaturity.${category.id}`)}</Text>
        <Text style={text}>{category.points} / {category.weight}</Text>
        <Text style={text}>{t(`safetyMaturity.level${category.level}`)}</Text>
        {category.resources.map(resource => <LayeredPillButton key={resource.id} onPress={() => router.push(`/work-hub/library/${resource.id}` as never)}><Text style={text}>{resource.title}</Text></LayeredPillButton>)}
        {(category.requirements ?? []).map(requirement => <View key={requirement.id} style={{ gap: 8, marginTop: 12 }}>
          <Text style={{ ...text, fontWeight: "600" }}>{requirement.id} — {requirement.title}</Text>
          <Text style={text}>{requirement.applicability}</Text>
          {requirement.resources.map(resource => <LayeredPillButton key={resource.id} onPress={() => router.push(`/work-hub/library/${resource.id}` as never)}><Text style={text}>{resource.title}</Text></LayeredPillButton>)}
        </View>)}
      </View>)}
    </ScrollView>
  </View>;
}
