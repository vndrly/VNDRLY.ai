import React from "react";
import { useTranslation } from "react-i18next";
import { Image, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import NotificationBell from "@/components/NotificationBell";
import { useUnreadNotificationCount } from "@/lib/notificationBadge";
import { useSidebarNotifications } from "@/components/SidebarNotificationsContext";

import AuthedImage from "@/components/AuthedImage";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import { VNDRLY_LOGO_SQUARE } from "@/lib/vndrly-brand-assets";

type Props = {
  title?: string;
  subtitle?: string;
  logoTestId: string;
  platformLogoTestId?: string;
  compact?: boolean;
  stacked?: boolean;
};

export default function BrandTitleRow({
  title,
  subtitle,
  logoTestId,
  platformLogoTestId,
  compact = false,
  stacked = false,
}: Props) {
  const brand = useBrand();
  const sidebarNotifications = useSidebarNotifications();
  const notificationCount = useUnreadNotificationCount(Boolean(platformLogoTestId));
  const colors = useColors();
  const { t } = useTranslation();
  const { activeMembership } = useAuth();
  const logoUri =
    (brand.isOrgBranded ? (brand.logoSquareUrl ?? brand.logoUrl) : null) ??
    activeMembership?.orgLogoUrl ??
    null;
  const brandName = brand.name ?? activeMembership?.orgName ?? t("home.brandWordmark");
  const logoStyle = stacked ? styles.stackedLogo : compact ? styles.compactLogo : styles.logo;
  const fallbackLogo = (
    <Image
      accessibilityLabel={brandName}
      resizeMode="contain"
      source={VNDRLY_LOGO_SQUARE}
      style={logoStyle}
      testID={logoTestId}
    />
  );

  return (
    <View
      style={[styles.row, stacked && styles.stackedRow]}
      testID={stacked ? "brand-title-stacked" : undefined}
    >
      {logoUri ? (
        <AuthedImage
          accessibilityLabel={brandName}
          fallback={fallbackLogo}
          resizeMode="contain"
          style={logoStyle}
          testID={logoTestId}
          uri={logoUri}
        />
      ) : (
        fallbackLogo
      )}
      <View style={styles.textCol}>
        <Text
          style={[styles.title, (compact || stacked) && styles.compactTitle, { color: colors.foreground }]}
        >
          {title ?? brandName}
        </Text>
        {subtitle ? (
          <Text
            style={[styles.subtitle, (compact || stacked) && styles.compactSubtitle, { color: colors.mutedForeground }]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {platformLogoTestId ? (
        <React.Fragment>
        {!sidebarNotifications ? <NotificationBell count={notificationCount} onPress={() => router.push("/(tabs)/gate-notifications")} /> : null}
        <Image
          accessibilityLabel="VNDRLY"
          resizeMode="contain"
          source={VNDRLY_LOGO_SQUARE}
          style={styles.logo}
          testID={platformLogoTestId}
        />
        </React.Fragment>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "center", flexDirection: "row", gap: 10 },
  logo: { height: 40, width: 40 },
  compactLogo: { height: 32, width: 32 },
  stackedLogo: { height: 44, width: 44 },
  stackedRow: { alignItems: "flex-start", flexDirection: "column", gap: 6 },
  textCol: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
  },
  compactTitle: { fontSize: 16 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 },
  compactSubtitle: { fontSize: 11 },
});
