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
};

export default function BrandTitleRow({ title, subtitle, logoTestId, platformLogoTestId }: Props) {
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
  const fallbackLogo = (
    <Image
      source={VNDRLY_LOGO_SQUARE}
      style={styles.logo}
      resizeMode="contain"
      testID={logoTestId}
      accessibilityLabel={brandName}
    />
  );

  return (
    <View style={styles.row}>
      {logoUri ? (
        <AuthedImage
          uri={logoUri}
          fallback={fallbackLogo}
          style={styles.logo}
          resizeMode="contain"
          testID={logoTestId}
          accessibilityLabel={brandName}
        />
      ) : (
        fallbackLogo
      )}
      <View style={styles.textCol}>
        <Text style={[styles.title, { color: colors.foreground }]}>{title ?? brandName}</Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
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
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  logo: {
    height: 40,
    width: 40,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    marginTop: 2,
  },
});
