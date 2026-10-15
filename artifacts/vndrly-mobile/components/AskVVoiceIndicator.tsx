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
  const voiceLabel = voiceStatus === "active" ? "Click to Stop V" : voiceStatus === "muted" ? "Click to Start V" : "AskV is Unavailable";
  if (
    !voice.preferencesReady ||
    (!inline && (pathname.endsWith("/askv") || pathname === "/" || pathname === "/company-operations" || pathname === "/fleet" || pathname.startsWith("/fleet/") || pathname.startsWith("/fleet-"))) ||
    (!inline && (pathname.endsWith("/new-ticket") || pathname.endsWith("/flagged") || pathname.endsWith("/crew-map") || pathname.endsWith("/crews") || pathname.endsWith("/change-over") || pathname.endsWith("/shift-notes") || pathname.endsWith("/gate") || pathname.endsWith("/gate-history") || pathname.endsWith("/gate-map") || pathname.endsWith("/notifications") || pathname.endsWith("/gate-notifications") || pathname.endsWith("/notification-preferences") || pathname.endsWith("/gate-notification-preferences") || pathname.endsWith("/profile") || pathname.endsWith("/edit-profile") || pathname.endsWith("/compliance") || pathname === "/work-hub" || pathname.startsWith("/work-hub/")))
  ) return null;
  return (
    <View
      pointerEvents="box-none"
      style={inline
        ? { alignItems: "flex-end", flexShrink: 1, maxWidth: 260, minWidth: 0 }
        : { alignItems: "flex-end", paddingHorizontal: 12, paddingTop: insets.top, paddingBottom: 8, flexShrink: 0 }}
      testID={inline ? "askv-inline-status" : "askv-global-status"}
    >
      <LayeredPillButton color={voiceStatus === "active" ? "#1f9a3d" : undefined} source={voiceStatus === "active" ? GREEN_APPROVAL_PILL : undefined} height={40} style={{ alignSelf: "flex-end", width: inline ? undefined : 260 }} onPress={() => {
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
