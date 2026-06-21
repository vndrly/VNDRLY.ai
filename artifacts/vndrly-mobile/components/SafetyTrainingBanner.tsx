import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { fetchSafetyTrainingStatus, type SafetyTrainingStatus } from "@/lib/safety-api";

type Props = {
  testID?: string;
};

export default function SafetyTrainingBanner({ testID = "banner-safety-training" }: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const [status, setStatus] = useState<SafetyTrainingStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchSafetyTrainingStatus()
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status || status.incompleteModules.length === 0) return null;

  return (
    <Pressable
      testID={testID}
      onPress={() => router.push("/safety-training")}
      style={{
        borderRadius: 10,
        borderWidth: 1,
        borderColor: "#fcd34d",
        backgroundColor: "#fffbeb",
        paddingHorizontal: 14,
        paddingVertical: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
      }}
    >
      <Feather name="shield" size={18} color="#b45309" />
      <View style={{ flex: 1 }}>
        <Text style={{ color: "#92400e", fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
          {t("safety.trainingBannerTitle")}
        </Text>
        <Text style={{ color: "#b45309", fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 }}>
          {t("safety.trainingBannerTap")}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}
