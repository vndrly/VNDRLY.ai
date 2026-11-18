import { ModalPressable as Pressable } from "@/components/ModalDraft";
import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

const voiceBack = require("@/assets/buttons/white-circle-voice-back.png");
const voiceOverlay = require("@/assets/buttons/white-circle-voice-overlay.png");

export const STANDARD_NAV_ICON_SIZE = 26;
export const VOICE_NAV_ICON_SIZE = STANDARD_NAV_ICON_SIZE * 1.125;

type Props = {
  active: boolean;
  label: string;
  onPress: () => void;
  testID?: string;
};

export default function GateVoiceNavButton({
  active,
  label,
  onPress,
  testID = "gate-voice-nav",
}: Props) {
  const colors = useColors();
  return (
    <Pressable
      aria-checked={active}
      aria-valuetext={active ? "Listening" : "Idle"}
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      accessibilityValue={{ text: active ? "Listening" : "Idle" }}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      testID={testID}
    >
      <View
        style={[
          styles.chrome,
          active && { borderColor: colors.primary, ...styles.activeChrome },
        ]}
      >
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="contain"
          source={voiceBack}
          style={[styles.layer, { tintColor: colors.primary }]}
          testID={`${testID}-back`}
        />
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="contain"
          source={voiceOverlay}
          style={styles.layer}
          testID={`${testID}-overlay`}
        />
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          { color: active ? colors.primary : colors.mutedForeground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    gap: 3,
    justifyContent: "center",
    minHeight: 56,
    minWidth: 44,
  },
  pressed: { opacity: 0.84 },
  chrome: {
    borderColor: "transparent",
    borderRadius: 999,
    borderWidth: 2,
    height: VOICE_NAV_ICON_SIZE + 4,
    position: "relative",
    width: VOICE_NAV_ICON_SIZE + 4,
  },
  activeChrome: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
  },
  layer: {
    height: VOICE_NAV_ICON_SIZE,
    left: 2,
    position: "absolute",
    top: 2,
    width: VOICE_NAV_ICON_SIZE,
  },
  label: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    maxWidth: 74,
    textAlign: "center",
  },
});
