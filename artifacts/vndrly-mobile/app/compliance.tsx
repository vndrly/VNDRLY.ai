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
import ProfilePhotoImage from "@/components/ProfilePhotoImage";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";

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

type Cert = {
  id: number;
  name: string;
  issuer: string | null;
  certNumber: string | null;
  issuedDate: string | null;
  expirationDate: string | null;
  documentUrl: string | null;
};

type ComplianceToken = {
  token: string;
  verifyUrl: string;
  expiresAt: string;
};

// Mirrors the four-bucket compliance status used by the web field
// portal (`artifacts/vndrly/src/pages/field-compliance.tsx`) so a
// field employee sees the same chip wherever they look.
//
//   - noExpiration → null         (neutral grey)
//   - expired      → days < 0     (red, TogglePill semantic)
//   - expiringSoon → 0..60 days   (amber, TogglePill semantic)
//   - active       → days > 60    (green, TogglePill semantic)
function statusOf(expirationDate: string | null, t: (k: string, opts?: Record<string, unknown>) => string) {
  if (!expirationDate) return { label: t("compliance.noExpiration"), color: "#6b7280", bg: "#f4f4f5" };
  const days = (new Date(expirationDate + "T00:00:00").getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (days < 0) return { label: t("compliance.expired"), color: "#b91c1c", bg: "#fee2e2" };
  if (days <= 60) return { label: t("compliance.expiringSoon"), color: "#92400e", bg: "#fef3c7" };
  return { label: t("compliance.active"), color: "#15803d", bg: "#dcfce7" };
}

export default function ComplianceScreen() {
  const c = useColors();
  const { t } = useTranslation();
  const [me, setMe] = useState<FieldMe | null>(null);
  const [certs, setCerts] = useState<Cert[] | null>(null);
  const [token, setToken] = useState<ComplianceToken | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meRes = await apiFetch<FieldMe>("/api/field/me");
        if (cancelled) return;
        setMe(meRes);
        const [certsRes, tokenRes] = await Promise.all([
          apiFetch<Cert[]>(`/api/field-employees/${meRes.employeeId}/certifications`),
          apiFetch<ComplianceToken>(`/api/field-employees/${meRes.employeeId}/compliance-token`),
        ]);
        if (cancelled) return;
        setCerts(certsRes);
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

            <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>{t("compliance.certifications")}</Text>
            {certs === null ? (
              <ActivityIndicator color={c.primary} />
            ) : certs.length === 0 ? (
              <Text style={{ color: c.mutedForeground, fontSize: 14 }}>{t("compliance.noCerts")}</Text>
            ) : (
              certs.map((cert) => {
                const s = statusOf(cert.expirationDate, t);
                return (
                  <View key={cert.id} style={[styles.certRow, { borderColor: c.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.certName, { color: c.foreground }]}>{cert.name}</Text>
                      <Text style={[styles.certMeta, { color: c.mutedForeground }]} numberOfLines={1}>
                        {cert.issuer || t("compliance.unknownIssuer")}
                        {cert.expirationDate
                          ? t("compliance.expirationSuffix", { date: cert.expirationDate })
                          : ""}
                      </Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: s.bg }]}>
                      <Text style={[styles.badgeText, { color: s.color }]}>{s.label}</Text>
                    </View>
                  </View>
                );
              })
            )}

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
  sectionLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 1, marginBottom: 4 },
  certRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 8, padding: 10, gap: 8 },
  certName: { fontSize: 14, fontWeight: "600" },
  certMeta: { fontSize: 12, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  qrWrap: { alignItems: "center", paddingTop: 16, borderTopWidth: 1 },
  qrCaption: { fontSize: 12, marginTop: 10, textAlign: "center" },
});
