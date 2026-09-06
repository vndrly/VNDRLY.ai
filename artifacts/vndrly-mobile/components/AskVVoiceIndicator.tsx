import React from "react";
import { Text, View } from "react-native";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import LayeredPillButton from "@/components/LayeredPillButton";
import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";

/** Root-mounted so microphone capture always has a visible state and stop control. */
export default function AskVVoiceIndicator() {
  const voice = useAskVVoiceSession();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  if (!voice.preferencesReady || pathname.endsWith("/askv") || voice.state === "stopped") return null;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", right: 12, bottom: Math.max(insets.bottom + 64, 80), width: 220, zIndex: 100 }} testID="askv-global-status">
      <LayeredPillButton height={40} onPress={() => {
        if (voice.muted) router.push("/(tabs)/askv" as never);
        voice.setMuted(!voice.muted);
      }}>
        <Text accessibilityLiveRegion="polite" style={{ color: "#fff", fontSize: 12 }}>
          AskV · {t(`askv.voiceState.${voice.muted ? "muted" : voice.state}`)} · {t(voice.muted ? "askv.unmute" : "askv.mute")}
        </Text>
      </LayeredPillButton>
    </View>
  );
}
