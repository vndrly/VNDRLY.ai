import React from "react";
import { Text, View } from "react-native";
import { usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import LayeredPillButton from "@/components/LayeredPillButton";
import AskVWaveform from "@/components/AskVWaveform";
import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";

/** Root-mounted so microphone capture always has a visible state and stop control. */
export default function AskVVoiceIndicator({ inline = false }: { inline?: boolean }) {
  const voice = useAskVVoiceSession();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  if (
    !voice.preferencesReady ||
    pathname.endsWith("/askv") ||
    (!inline && pathname.endsWith("/change-over"))
  ) return null;
  return (
    <View
      pointerEvents="box-none"
      style={inline
        ? { alignItems: "flex-end", flex: 1, maxWidth: 220, minWidth: 0 }
        : { position: "absolute", right: 12, bottom: Math.max(insets.bottom + 64, 80), width: 220, zIndex: 100 }}
      testID={inline ? "askv-inline-status" : "askv-global-status"}
    >
      <LayeredPillButton height={40} onPress={() => {
        voice.setMuted(!voice.muted);
      }} inactive={voice.muted} testID="askv-global-mute">
        <View style={{ alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "center" }}>
          <Text accessibilityLiveRegion="polite" style={{ color: "#fff", fontSize: 12 }}>
            AskV · {t(`askv.voiceState.${voice.muted ? "muted" : voice.state}`)} · {t(voice.muted ? "askv.unmute" : "askv.mute")}
          </Text>
          <AskVWaveform active={!voice.muted && (voice.state === "listening" || voice.state === "speaking")} />
        </View>
      </LayeredPillButton>
    </View>
  );
}
