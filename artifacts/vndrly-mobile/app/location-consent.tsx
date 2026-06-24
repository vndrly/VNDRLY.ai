import { Feather } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import * as Location from "expo-location";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import AmberButton from "@/components/AmberButton";
import InPageHeader from "@/components/InPageHeader";
import { useColors } from "@/hooks/useColors";
import { acceptConsent, setConsentDeclined } from "@/lib/locationConsent";
import { startLiveLocationReporter } from "@/lib/liveLocationReporter";

export default function LocationConsentScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const onAccept = async () => {
    setBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert(
          t("consent.permissionNeeded"),
          t("consent.permissionMessage"),
        );
      } else {
        // Best-effort background permission; if denied, we fall back to
        // foreground-only updates while the app is open.
        try { await Location.requestBackgroundPermissionsAsync(); } catch { /* ignore */ }
      }
      await acceptConsent();
      await setConsentDeclined(false);
      await startLiveLocationReporter();
      router.replace("/(tabs)");
    } catch (e: unknown) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("consent.couldNotSave"));
    } finally {
      setBusy(false);
    }
  };

  const onDecline = async () => {
    await setConsentDeclined(true);
    router.replace("/(tabs)");
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.pageBackground }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <InPageHeader
        title={t("consent.title")}
        onBack={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/(tabs)/profile");
        }}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.iconWrap, { backgroundColor: colors.accent }]}>
          <Feather name="map-pin" size={36} color={colors.accentForeground} />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {t("consent.title")}
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          {t("consent.bodyPrefix")} <Text style={styles.bold}>{t("consent.enRoute")}</Text> {t("consent.or")} <Text style={styles.bold}>{t("consent.onSite")}</Text> {t("consent.bodySuffix")}
        </Text>

        <View style={[styles.bullets, { borderColor: colors.border }]}>
          <Bullet icon="clock" text={t("consent.bullet1")} color={colors.mutedForeground} fg={colors.foreground} />
          <Bullet icon="users" text={t("consent.bullet2")} color={colors.mutedForeground} fg={colors.foreground} />
          <Bullet icon="trash-2" text={t("consent.bullet3")} color={colors.mutedForeground} fg={colors.foreground} />
          <Bullet icon="battery" text={t("consent.bullet4")} color={colors.mutedForeground} fg={colors.foreground} />
        </View>

        <AmberButton
          onPress={onAccept}
          disabled={busy}
          loading={busy}
          height={48}
          style={styles.primary}
          textStyle={styles.primaryText}
          testID="button-consent-accept"
        >
          {t("consent.accept")}
        </AmberButton>
        <TouchableOpacity onPress={onDecline} style={styles.secondary} testID="button-consent-decline">
          <Text style={[styles.secondaryText, { color: colors.foreground }]}>{t("consent.decline")}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function Bullet({ icon, text, color, fg }: { icon: any; text: string; color: string; fg: string }) {
  return (
    <View style={styles.bullet}>
      <Feather name={icon} size={16} color={color} style={{ marginTop: 2 }} />
      <Text style={[styles.bulletText, { color: fg }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: 24, alignItems: "center" },
  iconWrap: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 16, marginTop: 24 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", textAlign: "center", marginBottom: 12 },
  body: { fontSize: 15, lineHeight: 22, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 16 },
  bold: { fontFamily: "Inter_600SemiBold" },
  bullets: { width: "100%", borderWidth: 1, borderRadius: 12, padding: 12, gap: 10, marginBottom: 24 },
  bullet: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  bulletText: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
  primary: { width: "100%", paddingVertical: 14, borderRadius: 12, alignItems: "center", marginBottom: 8 },
  primaryText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  secondary: { width: "100%", paddingVertical: 14, alignItems: "center" },
  secondaryText: { fontSize: 15, fontFamily: "Inter_500Medium" },
});
