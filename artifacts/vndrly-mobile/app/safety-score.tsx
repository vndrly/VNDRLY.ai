import React from "react";
import { router, Stack } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import InPageHeader from "@/components/InPageHeader";
import LayeredPillButton from "@/components/LayeredPillButton";
import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import { fetchSafetyMetrics, fetchSafetyTrainingStatus } from "@/lib/safety-api";

export default function SafetyScoreScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const brand = useBrand();
  const metrics = useQuery({ queryKey: ["safety-metrics"], queryFn: fetchSafetyMetrics });
  const training = useQuery({ queryKey: ["safety-training-status"], queryFn: fetchSafetyTrainingStatus });
  const card = { backgroundColor: colors.card, borderColor: brand.primary, borderWidth: 2, borderRadius: 12, padding: 16, gap: 10 };
  const text = { color: colors.foreground };
  return <View style={{ flex: 1 }}>
    <Stack.Screen options={{ headerShown: false }} />
    <InPageHeader title={t("safety.scoreDetails.title")} onBack={() => router.canGoBack() ? router.back() : router.replace("/work-hub/safety")} />
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <View style={card}>
        <Text style={{ ...text, fontSize: 18, fontWeight: "600" }}>{t("safety.scoreDetails.company")}</Text>
        <Text style={{ ...text, fontSize: 36, fontWeight: "700" }}>{metrics.data ? `${metrics.data.safetyScore} / 100` : metrics.isError ? t("safety.scoreDetails.unavailable") : t("safety.scoreDetails.loading")}</Text>
        <Text style={text}>{t("safety.scoreDetails.explanation")}</Text>
        {metrics.data && <Text style={text}>{t("safety.scoreDetails.events", { count: metrics.data.openEventCount, hipo: metrics.data.openHipoCount })}</Text>}
        <Text style={text}>{t("safety.scoreDetails.improve")}</Text>
        <LayeredPillButton onPress={() => router.push("/safety-my-reports")}><Text style={text}>{t("safety.scoreDetails.reviewEvents")}</Text></LayeredPillButton>
      </View>
      <View style={card}>
        <Text style={{ ...text, fontSize: 18, fontWeight: "600" }}>{t("safety.scoreDetails.myActions")}</Text>
        <Text style={text}>{t("safety.scoreDetails.separate")}</Text>
        <Text style={text}>{training.isError ? t("safety.scoreDetails.unavailable") : training.data ? training.data.allComplete ? t("safety.trainingAllComplete") : t("safety.scoreDetails.trainingCount", { count: training.data.incompleteModules.length }) : t("safety.scoreDetails.loading")}</Text>
        {training.data?.incompleteModules.map(module => <Text key={module.id} style={text}>• {module.title}</Text>)}
        <LayeredPillButton onPress={() => router.push("/safety-training")}><Text style={text}>{t("safety.scoreDetails.training")}</Text></LayeredPillButton>
        <LayeredPillButton onPress={() => router.push("/work-hub/tasks-forms")}><Text style={text}>{t("safety.scoreDetails.assignments")}</Text></LayeredPillButton>
        <Text style={text}>{t("safety.scoreDetails.certHint")}</Text>
        <LayeredPillButton onPress={() => router.push("/compliance")}><Text style={text}>{t("safety.scoreDetails.certifications")}</Text></LayeredPillButton>
      </View>
    </ScrollView>
  </View>;
}
