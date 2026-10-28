import React, { useId, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { evaluateGpsFence } from "@workspace/gate-booth";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { changeOverRequest } from "@/lib/change-over-api";

type Choice = { id: string; name: string; siteId: number; latitude?: number | null; longitude?: number | null; siteLatitude?: number | null; siteLongitude?: number | null; geofenceRadiusM?: number | null };
export default function GateSiteGateSelect({ sites, siteId, gate, onChange, origin }: {
  sites: { id: number; name: string }[]; siteId?: number; gate?: { id: string; name: string };
  onChange: (siteId: number, gateId: string) => void;
  origin?: { latitude: number; longitude: number } | null;
}) {
  const { user } = useAuth(), colors = useColors(), { t } = useTranslation();
  const viewport = useWindowDimensions(), [open, setOpen] = useState(false), gradient = useId();
  const tablet = Platform.OS === "ios" ? Platform.isPad === true : viewport.width >= 768;
  const label = `${t("changeOver.site")} | ${t("changeOver.gate")}`;
  const query = useQuery({ queryKey: ["gate-site-gate-options", user?.id, user?.vendorId, user?.partnerId], queryFn: () => changeOverRequest<{ gates: Choice[] }>("/map"), enabled: sites.length > 0, retry: false });
  const choices = [...(query.data?.gates ?? [])].filter(row => sites.some(site => site.id === row.siteId));
  if (gate && siteId && !choices.some(row => row.id === gate.id)) choices.push({ ...gate, siteId });
  const current = choices.find(row => row.id === gate?.id);
  const site = sites.find(row => row.id === siteId);
  const latitude = current?.latitude ?? current?.siteLatitude, longitude = current?.longitude ?? current?.siteLongitude;
  const fence = evaluateGpsFence({ gps: origin ? "locked" : "unavailable", origin: origin ?? null, site: latitude != null && longitude != null ? { latitude, longitude, siteRadiusMeters: current?.geofenceRadiusM ?? 500 } : null });
  const status = fence.milesToSite == null ? "unavailable" : fence.insideFence ? "verified" : "mismatch";
  const endpoint = status === "verified" ? "#22c55e" : status === "mismatch" ? "#ef4444" : "#9ca3af";
  const text = site ? `${site.name} | ${gate?.name ?? t("gatekeeper.selectGateLocation")}` : t("changeOver.choose");
  return <View testID="site-gate-control" style={{ width: tablet ? 375 : 170, maxWidth: "100%", alignSelf: "center", gap: 4 }}>
    <Text style={{ textAlign: "center", color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{label}</Text>
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${text}`} accessibilityState={{ expanded: open }} onPress={() => setOpen(true)} testID="site-gate-selector"
        style={{ minHeight: 44, borderWidth: 2, borderColor: colors.primary, borderRadius: 22, paddingHorizontal: 12, justifyContent: "center" }}>
        <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: colors.foreground, paddingRight: 12 }}>{text}</Text>
        <Text accessible={false} style={{ position: "absolute", right: 10, color: colors.primary }}>⌄</Text>
      </Pressable>
      <Svg pointerEvents="none" width={32} height={52} viewBox="0 0 32 52" style={{ position: "absolute", right: -10, top: -4 }}>
        <Defs><LinearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><Stop offset="0%" stopColor="#f59e0b" /><Stop offset="100%" stopColor={endpoint} /></LinearGradient></Defs>
        <Path d="M 5 4 A 22 22 0 0 1 5 48" fill="none" stroke="#151719" strokeWidth={8} strokeLinecap="round" />
        <Path d="M 5 4 A 22 22 0 0 1 5 48" fill="none" stroke={`url(#${gradient})`} strokeWidth={5} strokeLinecap="round" />
      </Svg>
    </View>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <Pressable accessibilityLabel={t("common.close")} onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: "#0008", padding: 24, justifyContent: "center", alignItems: "center" }}>
        <View style={{ width: 375, maxWidth: "100%", maxHeight: "70%", borderRadius: 12, backgroundColor: colors.card, padding: 12 }}>
          <Text style={{ color: colors.foreground, textAlign: "center", fontWeight: "700", padding: 8 }}>{label}</Text>
          <ScrollView>{choices.map(row => <Pressable key={row.id} accessibilityRole="button" onPress={() => { onChange(row.siteId, row.id); setOpen(false); }} style={{ minHeight: 44, justifyContent: "center", padding: 10 }}>
            <Text style={{ color: row.id === gate?.id ? colors.primary : colors.foreground }}>{sites.find(site => site.id === row.siteId)?.name} | {row.name}</Text>
          </Pressable>)}</ScrollView>
        </View>
      </Pressable>
    </Modal>
  </View>;
}
