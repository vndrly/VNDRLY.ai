import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Linking, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useColors } from "@/hooks/useColors";
import { APP_SCREEN_ROOT } from "@/lib/nav-pane-tokens";
import InPageHeader from "@/components/InPageHeader";
import LayeredPillButton from "@/components/LayeredPillButton";
import {
  completeSafetyTrainingModule,
  fetchSafetyTrainingStatus,
  type SafetyTrainingModule,
} from "@/lib/safety-api";

export default function SafetyTrainingScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const [modules, setModules] = useState<SafetyTrainingModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [completingId, setCompletingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchSafetyTrainingStatus();
      setModules(data.incompleteModules);
    } catch {
      setModules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const markComplete = async (moduleId: number) => {
    setCompletingId(moduleId);
    try {
      await completeSafetyTrainingModule(moduleId);
      await load();
      Alert.alert(t("safety.trainingCompleteToast"));
    } catch (e) {
      Alert.alert(t("safety.trainingCompleteFailed"), String(e));
    } finally {
      setCompletingId(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: APP_SCREEN_ROOT }}>
      <InPageHeader title={t("safety.trainingPageTitle")} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={{ color: colors.mutedForeground }}>{t("safety.trainingPageSubtitle")}</Text>
        {loading ? (
          <Text style={{ color: colors.mutedForeground }}>{t("common.loading")}</Text>
        ) : modules.length === 0 ? (
          <Text style={{ color: colors.mutedForeground }}>{t("safety.trainingAllComplete")}</Text>
        ) : (
          modules.map((mod) => (
            <View
              key={mod.id}
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                padding: 14,
                gap: 10,
                backgroundColor: colors.card,
              }}
            >
              <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 16 }}>
                {mod.title}
              </Text>
              {mod.description ? (
                <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>{mod.description}</Text>
              ) : null}
              <LayeredPillButton
                inactive
                height={36}
                onPress={() => void Linking.openURL(mod.videoUrl)}
                testID={`link-training-video-${mod.id}`}
              >
                <Text style={{ color: "#ffffff", fontFamily: "Inter_600SemiBold" }}>
                  {t("safety.trainingWatchVideo")}
                </Text>
              </LayeredPillButton>
              <LayeredPillButton
                height={40}
                onPress={() => void markComplete(mod.id)}
                disabled={completingId === mod.id}
                loading={completingId === mod.id}
                testID={`button-complete-training-${mod.id}`}
              >
                <Text style={{ color: "#ffffff", fontFamily: "Inter_600SemiBold" }}>
                  {t("safety.trainingMarkComplete")}
                </Text>
              </LayeredPillButton>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
