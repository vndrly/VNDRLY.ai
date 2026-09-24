import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import AskVVoiceIndicator from "@/components/AskVVoiceIndicator";
import BrandTitleRow from "@/components/BrandTitleRow";
import SphereBackButton from "@/components/SphereBackButton";
import { useColors } from "@/hooks/useColors";

type Props = {
  title: string;
  testIdPrefix: string;
  fallbackHref?: string;
};

/** Approved iOS portal header: company identity, then true Back + page title + Ask V. */
export default function PortalPageHeader({
  title,
  testIdPrefix,
  fallbackHref = "/profile",
}: Props) {
  const colors = useColors();

  const goBack = () => {
    // Profile is a tab route, so the generic history entry can point at Dashboard.
    // Dismiss to the originating Profile route when it exists; Expo falls back to
    // replacing with Profile only for a direct-opened page with no Profile entry.
    router.dismissTo(fallbackHref as never);
  };

  return (
    <View style={styles.standardHeader} testID={`${testIdPrefix}-standard-header`}>
      <BrandTitleRow
        subtitle="iOS Portal"
        logoTestId={`${testIdPrefix}-company-logo`}
        platformLogoTestId={`${testIdPrefix}-vndrly-logo`}
      />
      <View style={styles.pageTitleRow}>
        <View style={styles.pageTitleStart}>
          <SphereBackButton
            onPress={goBack}
            size={40}
            testID={`${testIdPrefix}-page-back`}
          />
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={[styles.pageTitle, { color: colors.foreground }]}
          >
            {title}
          </Text>
        </View>
        <AskVVoiceIndicator inline />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  standardHeader: {
    gap: 14,
    marginBottom: 14,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  pageTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  pageTitleStart: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 10,
    minWidth: 0,
  },
  pageTitle: {
    flexShrink: 1,
    fontFamily: "Inter_700Bold",
    fontSize: 20,
  },
});
