import { pageBack } from "@/lib/page-back";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import AskVVoiceIndicator from "@/components/AskVVoiceIndicator";
import BrandTitleRow from "@/components/BrandTitleRow";
import SphereBackButton from "@/components/SphereBackButton";
import { useColors } from "@/hooks/useColors";
import { iosPageLayout } from "@/lib/ios-page-layout";

type Props = {
  title: string;
  testIdPrefix: string;
  notificationHref?: string;
  beforeTitle?: React.ReactNode;
  afterTitle?: React.ReactNode;
};

/** Approved iOS portal header: company identity, then true Back + page title + Ask V. */
export default function PortalPageHeader({
  title,
  testIdPrefix,
  notificationHref,
  beforeTitle,
  afterTitle,
}: Props) {
  const colors = useColors();

  return (
    <View style={[styles.standardHeader, iosPageLayout && { paddingTop: 8, gap: 8, marginBottom: 8 }]} testID={`${testIdPrefix}-standard-header`}>
      {!iosPageLayout && <BrandTitleRow
        subtitle="iOS Portal"
        notificationHref={notificationHref}
        logoTestId={`${testIdPrefix}-company-logo`}
        platformLogoTestId={`${testIdPrefix}-vndrly-logo`}
      />}
      {beforeTitle}
      <View style={styles.pageTitleRow}>
        <View style={styles.pageTitleStart}>
          <SphereBackButton
            onPress={() => pageBack()}
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {iosPageLayout && <BrandTitleRow notificationHref={notificationHref} logoTestId={`${testIdPrefix}-company-logo`} platformLogoTestId={`${testIdPrefix}-vndrly-logo`} />}
          <AskVVoiceIndicator inline />
        </View>
      </View>
      {afterTitle}
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
