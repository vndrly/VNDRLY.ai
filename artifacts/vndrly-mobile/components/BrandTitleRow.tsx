import React from "react";
import { useTranslation } from "react-i18next";
import { Image, StyleSheet, Text, View } from "react-native";

import AuthedImage from "@/components/AuthedImage";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import { VNDRLY_LOGO_SQUARE } from "@/lib/vndrly-brand-assets";

type Props = {
  title?: string;
  subtitle?: string;
  logoTestId: string;
};

export default function BrandTitleRow({ title, subtitle, logoTestId }: Props) {
  const brand = useBrand();
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
    fontSize: 24,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    marginTop: 2,
  },
});
