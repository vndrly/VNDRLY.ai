import React from "react";
import { View } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
  type SafeAreaViewProps,
} from "react-native-safe-area-context";

import { screenTopPadding } from "@/lib/screen-insets";

type Props = SafeAreaViewProps & {
  /** Set false when a child InPageHeader applies the top gap. Default true. */
  includeTopGap?: boolean;
};

/**
 * Full-screen shell with consistent iOS top breathing room below the status bar.
 * Matches the home landing page gap (`insets.top + 8` on iOS).
 */
export default function ScreenSafeArea({
  children,
  style,
  edges,
  includeTopGap = true,
  ...rest
}: Props) {
  const insets = useSafeAreaInsets();

  if (!includeTopGap) {
    return (
      <SafeAreaView style={style} edges={edges} {...rest}>
        {children}
      </SafeAreaView>
    );
  }

  const sideEdges: SafeAreaViewProps["edges"] = Array.isArray(edges)
    ? edges.filter((edge) => edge !== "top")
    : edges ?? (["left", "right", "bottom"] as const);

  return (
    <SafeAreaView style={[{ flex: 1 }, style]} edges={sideEdges} {...rest}>
      <View style={{ flex: 1, paddingTop: screenTopPadding(insets.top) }}>
        {children}
      </View>
    </SafeAreaView>
  );
}
