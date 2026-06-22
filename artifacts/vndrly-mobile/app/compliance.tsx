import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";

import InPageHeader from "@/components/InPageHeader";
import EmployeeCertificationsPanel from "@/components/EmployeeCertificationsPanel";
import ProfilePhotoImage from "@/components/ProfilePhotoImage";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { SCREEN_ROOT_BACKGROUND } from "@/lib/nav-pane-tokens";

type FieldMe = {
  employeeId: number;
  firstName: string;
  lastName: string;
  email: string;
  vendorName: string | null;
  jobTitle: string | null;
  vendorLogoUrl: string | null;
  profilePhotoPath: string | null;
  photoUrl?: string | null;
};

type ComplianceToken = {
  token: string;
  verifyUrl: string;
  expiresAt: string;
};


export default function ComplianceScreen() {
  const c = useColors();
  const { t } = useTranslation();
  const [me, setMe] = useState<FieldMe | null>(null);
  const [token, setToken] = useState<ComplianceToken | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meRes = await apiFetch<FieldMe>("/api/field/me");
        if (cancelled) return;
        setMe(meRes);
        const tokenRes = await apiFetch<ComplianceToken>(`/api/field-employees/${meRes.employeeId}/compliance-token`);
        if (cancelled) return;
        setToken(tokenRes);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const hasPhoto = !!(me?.profilePhotoPath || me?.photoUrl);

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <InPageHeader title={t("compliance.title")} />

      <ScrollView contentContainerStyle={styles.content}>
        {error ? (
          <Text style={{ color: c.destructive, textAlign: "center", padding: 16 }}>{error}</Text>
        ) : !me ? (
          <ActivityIndicator color={c.primary} style={{ marginTop: 40 }} />
        ) : (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.brandRow}>
              <View style={styles.brandLeft}>
                <Feather name="shield" size={16} color={c.primary} />
                <Text style={[styles.brandText, { color: c.primary }]}>{t("compliance.brand")}</Text>
              </View>
              <Text style={[styles.idText, { color: c.mutedForeground }]}>{t("compliance.id", { id: me.employeeId })}</Text>
            </View>

            <View style={styles.identityRow}>
              {hasPhoto ? (
                <ProfilePhotoImage
                  profilePhotoPath={me.profilePhotoPath}
                  photoUrl={me.photoUrl}
                  style={styles.avatar}
                />
              ) : (
                <View style={[styles.avatar, { backgroundColor: c.muted, alignItems: "center", justifyContent: "center" }]}>
                  <Feather name="user" size={32} color={c.mutedForeground} />
                </View>
              )}
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.name, { color: c.foreground }]}>{me.firstName} {me.lastName}</Text>
                {me.jobTitle ? <Text style={[styles.sub, { color: c.mutedForeground }]}>{me.jobTitle}</Text> : null}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                  {me.vendorLogoUrl ? (
                    <Image source={{ uri: me.vendorLogoUrl }} style={{ width: 20, height: 20, borderRadius: 4 }} />
                  ) : null}
                  {me.vendorName ? <Text style={[styles.vendor, { color: c.foreground }]}>{me.vendorName}</Text> : null}
                </View>
              </View>
            </View>

            <EmployeeCertificationsPanel employeeId={me.employeeId} />

            <View style={[styles.qrWrap, { borderTopColor: c.border }]}>
              {token ? (
                <>
                  <View style={{ backgroundColor: "#fff", padding: 12, borderRadius: 8 }}>
                    <QRCode value={token.verifyUrl} size={180} />
                  </View>
                  <Text style={[styles.qrCaption, { color: c.mutedForeground }]}>
                    {t("compliance.qrCaption")}
                  </Text>
                </>
              ) : (
                <ActivityIndicator color={c.primary} />
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  card: { borderRadius: 16, borderWidth: 1, padding: 20, gap: 16 },
  brandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brandLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  brandText: { fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  idText: { fontSize: 11 },
  identityRow: { flexDirection: "row", alignItems: "center" },
  avatar: { width: 72, height: 72, borderRadius: 36 },
  name: { fontSize: 18, fontWeight: "700" },
  sub: { fontSize: 13, marginTop: 2 },
  vendor: { fontSize: 13, fontWeight: "600", marginTop: 2 },
  qrWrap: { alignItems: "center", paddingTop: 16, borderTopWidth: 1, marginTop: 8 },
  qrCaption: { fontSize: 12, marginTop: 10, textAlign: "center" },
});
