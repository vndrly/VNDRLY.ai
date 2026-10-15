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
import { fetchSafetyMetrics, fetchCompanySafetyReadiness } from "@/lib/safety-api";

export default function SafetyScoreScreen() {
  const { t } = useTranslation();
  const { user, activeMembershipId } = useAuth();
  const colors = useColors();
  const brand = useBrand();
  const metrics = useQuery({ queryKey: ["safety-metrics"], queryFn: fetchSafetyMetrics });
  const readiness = useQuery({ queryKey: ["company-safety-readiness", user?.id, activeMembershipId], queryFn: fetchCompanySafetyReadiness });
  const card = { backgroundColor: colors.card, borderColor: brand.primary, borderWidth: 2, borderRadius: 12, padding: 16, gap: 10 };
  const text = { color: colors.foreground };
  return <View style={{ flex: 1 }}>
    <Stack.Screen options={{ headerShown: false }} />
    <InPageHeader title={t("safety.scoreDetails.title")} onBack={() => router.canGoBack() ? router.back() : router.replace("/work-hub/safety")} />
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <View style={card}>
        <Text style={{ ...text, fontSize: 18, fontWeight: "600" }}>{t("safety.scoreDetails.company")}</Text>
        <Text style={{ ...text, fontSize: 36, fontWeight: "700" }}>{readiness.data ? `${readiness.data.score} / 100` : readiness.isError ? t("safety.scoreDetails.unavailable") : t("safety.scoreDetails.loading")}</Text>
        <Text style={text}>{t("safety.scoreDetails.explanation")}</Text>
        {metrics.data && <Text style={text}>{t("safety.scoreDetails.events", { count: metrics.data.openEventCount, hipo: metrics.data.openHipoCount })}</Text>}
        <Text style={text}>{t("safety.scoreDetails.improve")}</Text>
        <LayeredPillButton onPress={() => router.push("/safety-my-reports")}><Text style={text}>{t("safety.scoreDetails.reviewEvents")}</Text></LayeredPillButton>
      </View>
      <View style={card}>
        <Text style={{ ...text, fontSize: 18, fontWeight: "600" }}>{t("safety.readiness.title")}</Text>
        <Text style={text}>{t("safety.readiness.weights")}</Text>
        {readiness.isError && <Text style={text}>{t("safety.scoreDetails.unavailable")}</Text>}
        {readiness.isLoading && <Text style={text}>{t("safety.scoreDetails.loading")}</Text>}
        {readiness.data && <>
          <Text style={text}>{t("safety.readiness.contributions", { readiness: readiness.data.readinessPoints.toFixed(1), incident: readiness.data.incidentPoints.toFixed(1) })}</Text>
          {readiness.data.provisional && <Text style={text}>{t("safety.readiness.provisional", { minimum: readiness.data.score, maximum: readiness.data.maximumScore })}</Text>}
          {readiness.data.categories.map(category => <View key={category.id} style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 10, gap: 6 }}>
            <Text style={{ ...text, fontWeight: "600" }}>{t(`safety.readiness.${category.id}`)}</Text>
            <Text style={text}>{category.required ? t("safety.readiness.counts", { completed: category.completed, required: category.required, outstanding: category.outstanding, unknown: category.unknown }) : t("safety.readiness.noEvidence")}</Text>
            <Text style={text}>{t("safety.readiness.points", { points: category.points.toFixed(1) })}</Text>
            {readiness.data!.canManage && <LayeredPillButton onPress={() => router.push(category.id === "training" || category.id === "acknowledgements" ? "/work-hub/library" : category.id === "drivers" || category.id === "inspections" ? "/fleet" : category.id === "credentials" ? "/company-operations" : "/safety-my-reports")}><Text style={text}>{t(`safety.readiness.action_${category.id}`)}</Text></LayeredPillButton>}
          </View>)}
          <Text style={text}>{t("safety.readiness.coverageNote")}</Text>
        </>}
      </View>
    </ScrollView>
  </View>;
}
