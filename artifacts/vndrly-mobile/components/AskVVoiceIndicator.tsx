import React from "react";
import { Text, View } from "react-native";
import { usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import LayeredPillButton from "@/components/LayeredPillButton";
import AskVWaveform from "@/components/AskVWaveform";
import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";

const GREEN_APPROVAL_PILL = require("@/assets/pills/pill_green_approval1.png");

/** Root-mounted so microphone capture always has a visible state and stop control. */
export default function AskVVoiceIndicator({ inline = false }: { inline?: boolean }) {
  const voice = useAskVVoiceSession();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const voiceUnavailable = voice.state === "error";
  const voiceActive = !voice.muted && ["connecting", "greeting", "listening", "thinking", "speaking", "wake-idle"].includes(voice.state);
  const voiceStatus = voiceUnavailable ? "unavailable" : voiceActive ? "active" : "muted";
  const voiceLabel = voiceStatus === "active" ? "AskV is Active" : voiceStatus === "muted" ? "AskV is Muted" : "AskV is Unavailable";
  if (
    !voice.preferencesReady ||
    (!inline && pathname.endsWith("/askv")) ||
    (!inline && (pathname.endsWith("/change-over") || pathname.endsWith("/shift-notes") || pathname.endsWith("/gate") || pathname.endsWith("/gate-history") || pathname.endsWith("/profile") || pathname.endsWith("/edit-profile") || pathname.endsWith("/compliance") || pathname === "/work-hub" || pathname.startsWith("/work-hub/")))
  ) return null;
  return (
    <View
      pointerEvents="box-none"
      style={inline
        ? { alignItems: "flex-end", flexShrink: 1, maxWidth: 260, minWidth: 0 }
        : { position: "absolute", right: 12, bottom: Math.max(insets.bottom + 64, 80), width: 260, zIndex: 100 }}
      testID={inline ? "askv-inline-status" : "askv-global-status"}
    >
      <LayeredPillButton color={voiceStatus === "active" ? "#1f9a3d" : undefined} source={voiceStatus === "active" ? GREEN_APPROVAL_PILL : undefined} height={40} style={{ alignSelf: inline ? "flex-end" : "stretch" }} onPress={() => {
        voice.setMuted(voiceActive);
      }} inactive={voiceStatus !== "active"} testID="askv-global-mute">
        <View style={{ alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "center" }}>
          <Text accessibilityLiveRegion="polite" style={{ color: voiceStatus === "active" ? "#fff" : "#1a1d23", fontSize: 14, fontWeight: "600" }}>
            {voiceLabel}
          </Text>
          <AskVWaveform active={voiceActive} color={voiceStatus === "active" ? "#ffffff" : "#1a1d23"} />
        </View>
      </LayeredPillButton>
    </View>
  );
}
