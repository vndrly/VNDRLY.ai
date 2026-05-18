import React from "react";
import { Image, Pressable, View, type ViewStyle } from "react-native";

import { useColors } from "@/hooks/useColors";

const baseSphere = require("../assets/buttons/sphere-back-base.png");
const glossSphere = require("../assets/buttons/sphere-back-gloss.png");
const arrowIcon = require("../assets/buttons/sphere-back-arrow.png");

interface Props {
  size?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: ViewStyle;
  testID?: string;
}

export default function SphereBackButton({
  size = 40,
  onPress,
  accessibilityLabel = "Back",
  style,
  testID,
}: Props) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      testID={testID ?? "sphere-back-button"}
      style={({ pressed }) => [
        { width: size, height: size, opacity: pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {({ pressed }) => (
        <View style={{ width: size, height: size }}>
          <Image
            source={baseSphere}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: size,
              height: size,
              tintColor: colors.primary,
            }}
            resizeMode="contain"
          />
          <Image
            source={glossSphere}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: size,
              height: size,
              opacity: pressed ? 1 : 0,
            }}
            resizeMode="contain"
          />
          <Image
            source={arrowIcon}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: size,
              height: size,
              tintColor: "#ffffff",
            }}
            resizeMode="contain"
          />
        </View>
      )}
    </Pressable>
  );
}
