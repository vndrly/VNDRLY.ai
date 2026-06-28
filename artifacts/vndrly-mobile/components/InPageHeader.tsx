import { router } from "expo-router";
import React from "react";
import { Text, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import SphereBackButton from "@/components/SphereBackButton";
import { useColors } from "@/hooks/useColors";
import { screenTopPadding } from "@/lib/screen-insets";
import { SCREEN_TITLE_TEXT } from "@/lib/pill-doctrine";

type Props = {
  title: string;
  /** Optional right-side slot — e.g. FreshnessPill + refresh icon. */
  right?: React.ReactNode;
  /** Override the default `router.back()` behaviour. */
  onBack?: () => void;
  /** Hide the back affordance entirely (use on tab roots). */
  hideBack?: boolean;
  /** Parent already applied status-bar inset — skip safe-area top padding. */
  suppressTopInset?: boolean;
  style?: ViewStyle;
  testID?: string;
};

/**
 * In-page header used as a replacement for the native Stack header.
 *
 * Drops the back arrow + title + right-side controls **inside** the
 * scrolling content so they sit just above the page body (e.g. above the
 * tracking number on the ticket detail screen) instead of being clipped
 * by the device status bar / notch.
 *
 * The companion screens must set `Stack.Screen options={{ headerShown: false }}`
 * so the native header doesn't double up.
 */
export default function InPageHeader({
  title,
  right,
  onBack,
  hideBack,
  suppressTopInset,
  style,
  testID,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    if (router.canGoBack()) {
      router.back();
    }
  };

  return (
    <View
      style={[
        {
          paddingTop: suppressTopInset ? 0 : screenTopPadding(insets.top),
          paddingBottom: 8,
          paddingHorizontal: 12,
          backgroundColor: "transparent",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        },
        style,
      ]}
      testID={testID ?? "in-page-header"}
    >
      {hideBack ? (
        <View style={{ width: 40 }} />
      ) : (
        <SphereBackButton
          size={40}
          onPress={handleBack}
          testID="in-page-header-back"
        />
      )}
      <Text
        numberOfLines={1}
        style={{
          flex: 1,
          color: colors.foreground,
          fontSize: 17,
          fontFamily: "Inter_600SemiBold",
          ...SCREEN_TITLE_TEXT,
        }}
        testID="in-page-header-title"
      >
        {title}
      </Text>
      {right ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {right}
        </View>
      ) : null}
    </View>
  );
}
