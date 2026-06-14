import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useScreenTopPadding } from "@/lib/screen-insets";
import { WebView } from "react-native-webview";

import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { translateApiError } from "@/lib/apiErrors";
import {
  buildCrewMapHtml,
  type CrewMapLocation,
  type CrewMapSite,
} from "@/lib/crew-map-html";
import { SCREEN_SUBTITLE_TEXT, SCREEN_TITLE_TEXT, TEXT_SHADOW } from "@/lib/pill-doctrine";

type OverviewSite = CrewMapSite & {
  nearbyCount?: number;
  radiusMeters?: number;
};

type OverviewEmployee = {
  employeeId: number;
  employeeName: string;
  latitude: number;
  longitude: number;
  nearestSiteId: number;
  distanceMeters: number;
  lifecycleState: string | null;
  ticketId: number;
  recordedAt: string;
  batteryLevel: number | null;
  speedMps: number | null;
};

type NearbyEmployee = {
  employeeId: number;
  employeeName: string;
  vendorId: number | null;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  lifecycleState: string | null;
  heading: number | null;
  recordedAt: string;
  activeTicket: {
    ticketId: number;
    lifecycleState: string | null;
    siteName: string | null;
    siteCode: string | null;
  } | null;
};

function lifecycleColor(state: string | null): string {
  if (state === "en_route") return "#f59e0b";
  if (state === "on_location") return "#6366f1";
  if (state === "on_site") return "#10b981";
  return "#0ea5e9";
}

export default function PartnerSiteCrewMapScreen() {
  const colors = useColors();
  const brand = useBrand();
  const { t } = useTranslation();
  const topPadding = useScreenTopPadding();
  const [sites, setSites] = useState<OverviewSite[]>([]);
  const [allSites, setAllSites] = useState<OverviewSite[]>([]);
  const [locations, setLocations] = useState<CrewMapLocation[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<number | "all">("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siteMenuOpen, setSiteMenuOpen] = useState(false);
  const apiBaseRef = useRef(
    process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : "",
  );

  const load = useCallback(async () => {
    try {
      setError(null);
      const [vendorRows, ticketRows] = await Promise.all([
        apiFetch<Array<{ id: number; name: string }>>("/api/vendors").catch(() => []),
        apiFetch<Array<{ id: number; vendorName: string | null }>>("/api/tickets").catch(() => []),
      ]);
      const vendorMap = new Map(
        (Array.isArray(vendorRows) ? vendorRows : []).map((v) => [v.id, v.name]),
      );
      const ticketMap = new Map(
        (Array.isArray(ticketRows) ? ticketRows : [])
          .filter((row) => row.vendorName)
          .map((row) => [row.id, row.vendorName as string]),
      );

      const resolveVendor = (vendorId: number | null | undefined, ticketId: number) => {
        if (vendorId != null && vendorMap.has(vendorId)) return vendorMap.get(vendorId) ?? null;
        return ticketMap.get(ticketId) ?? null;
      };

      if (selectedSiteId === "all") {
        const json = await apiFetch<{
          sites?: OverviewSite[];
          employees?: OverviewEmployee[];
        }>("/api/site-map/overview");
        const siteRows = json?.sites ?? [];
        setAllSites(siteRows);
        setSites(siteRows);
        const siteById = new Map(siteRows.map((s) => [s.id, s]));
        setLocations(
          (json?.employees ?? []).map((emp) => {
            const site = siteById.get(emp.nearestSiteId);
            return {
              employeeId: emp.employeeId,
              employeeName: emp.employeeName,
              ticketId: emp.ticketId,
              vendorName: resolveVendor(null, emp.ticketId),
              lifecycleState: emp.lifecycleState,
              siteName: site?.name ?? null,
              siteCode: null,
              siteLatitude: site?.latitude ?? null,
              siteLongitude: site?.longitude ?? null,
              latitude: emp.latitude,
              longitude: emp.longitude,
              batteryLevel: emp.batteryLevel,
              heading: null,
              speedMps: emp.speedMps,
              recordedAt: emp.recordedAt,
            };
          }),
        );
      } else {
        const json = await apiFetch<{
          site: CrewMapSite & { siteCode?: string | null; siteRadiusMeters?: number | null };
          employees?: NearbyEmployee[];
        }>(`/api/site-map/${selectedSiteId}/nearby`);
        const site = json.site;
        setSites([
          {
            id: site.id,
            name: site.name,
            latitude: site.latitude,
            longitude: site.longitude,
            siteRadiusMeters: site.siteRadiusMeters,
          },
        ]);
        setLocations(
          (json?.employees ?? []).map((emp) => {
            const ticketId = emp.activeTicket?.ticketId ?? 0;
            return {
              employeeId: emp.employeeId,
              employeeName: emp.employeeName,
              ticketId,
              vendorName: resolveVendor(emp.vendorId, ticketId),
              lifecycleState:
                emp.activeTicket?.lifecycleState ?? emp.lifecycleState ?? null,
              siteName: site.name,
              siteCode: emp.activeTicket?.siteCode ?? null,
              siteLatitude: site.latitude ?? null,
              siteLongitude: site.longitude ?? null,
              latitude: emp.latitude,
              longitude: emp.longitude,
              batteryLevel: null,
              heading: emp.heading,
              speedMps: null,
              recordedAt: emp.recordedAt,
            };
          }),
        );
      }
    } catch (e) {
      setError(translateApiError(e, t));
      setLocations([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedSiteId, t]);

  useEffect(() => {
    setLoading(true);
    void load();
    const id = setInterval(() => void load(), 5 * 60_000);
    return () => clearInterval(id);
  }, [load]);

  const mapHtml = useMemo(
    () =>
      buildCrewMapHtml(locations, sites, brand.primary, apiBaseRef.current, {
        enableLiveEvents: false,
      }),
    [locations, sites, brand.primary],
  );

  function openDirections(lat: number, lng: number) {
    const url =
      Platform.OS === "ios"
        ? `https://maps.apple.com/?ll=${lat},${lng}`
        : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    void Linking.openURL(url);
  }

  const sitePickerSites = allSites;

  const selectedSiteLabel = useMemo(() => {
    if (selectedSiteId === "all") return t("partnerMap.allSites");
    const site = allSites.find((s) => s.id === selectedSiteId);
    if (!site) return t("partnerMap.selectSite");
    const count = site.nearbyCount != null ? ` (${site.nearbyCount})` : "";
    return `${site.name}${count}`;
  }, [allSites, selectedSiteId, t]);

  function pickSite(siteId: number | "all") {
    setSelectedSiteId(siteId);
    setSiteMenuOpen(false);
  }

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPadding }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={colors.primary}
        />
      }
    >
      <Text style={[styles.title, { color: colors.foreground }]}>{t("partnerMap.title")}</Text>
      <Text style={[styles.sub, { color: colors.mutedForeground }]}>{t("partnerMap.subtitle")}</Text>

      <Text style={[styles.siteLabel, { color: colors.mutedForeground }]}>
        {t("partnerMap.selectSite")}
      </Text>
      <Pressable
        onPress={() => setSiteMenuOpen(true)}
        style={[
          styles.siteSelect,
          { borderColor: colors.border, backgroundColor: colors.card },
        ]}
        testID="partner-map-site-dropdown"
      >
        <Text
          style={[styles.siteSelectText, { color: colors.foreground }]}
          numberOfLines={2}
        >
          {selectedSiteLabel}
        </Text>
        <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
      </Pressable>

      <Modal
        visible={siteMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSiteMenuOpen(false)}
      >
        <Pressable
          style={styles.menuBackdrop}
          onPress={() => setSiteMenuOpen(false)}
        >
          <Pressable
            style={[
              styles.menuSheet,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.menuTitle, { color: colors.foreground }]}>
              {t("partnerMap.selectSite")}
            </Text>
            <ScrollView style={styles.menuList} keyboardShouldPersistTaps="handled">
              <TouchableOpacity
                onPress={() => pickSite("all")}
                style={[
                  styles.menuOption,
                  {
                    borderBottomColor: colors.border,
                    backgroundColor:
                      selectedSiteId === "all" ? `${colors.primary}18` : "transparent",
                  },
                ]}
                testID="partner-map-all-sites"
              >
                <Text
                  style={[
                    styles.menuOptionText,
                    {
                      color: colors.foreground,
                      fontFamily:
                        selectedSiteId === "all" ? "Inter_600SemiBold" : "Inter_400Regular",
                    },
                  ]}
                >
                  {t("partnerMap.allSites")}
                </Text>
              </TouchableOpacity>
              {sitePickerSites.map((site) => {
                const active = selectedSiteId === site.id;
                const count =
                  site.nearbyCount != null ? ` (${site.nearbyCount})` : "";
                return (
                  <TouchableOpacity
                    key={site.id}
                    onPress={() => pickSite(site.id)}
                    style={[
                      styles.menuOption,
                      {
                        borderBottomColor: colors.border,
                        backgroundColor: active ? `${colors.primary}18` : "transparent",
                      },
                    ]}
                    testID={`partner-map-site-${site.id}`}
                  >
                    <Text
                      style={[
                        styles.menuOptionText,
                        {
                          color: colors.foreground,
                          fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular",
                        },
                      ]}
                    >
                      {site.name}
                      {count}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              onPress={() => setSiteMenuOpen(false)}
              style={styles.menuCancel}
              testID="partner-map-site-dropdown-cancel"
            >
              <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }}>
                {t("common.cancel")}
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <View style={[styles.mapWrap, { borderColor: colors.border }]} testID="partner-site-crew-map">
        {loading ? (
          <View style={styles.mapLoading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <WebView
            originWhitelist={["*"]}
            source={{ html: mapHtml }}
            style={styles.map}
            scrollEnabled={false}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
          />
        )}
      </View>

      {error ? (
        <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
      ) : null}

      <Text style={[styles.section, { color: colors.foreground }]}>
        {t("partnerMap.onSiteNow", { count: locations.length })}
      </Text>
      {locations.length === 0 && !loading ? (
        <Text style={{ color: colors.mutedForeground }}>{t("partnerMap.nobodyNearby")}</Text>
      ) : (
        locations.map((loc) => (
          <Pressable
            key={`${loc.employeeId}-${loc.ticketId}-${loc.recordedAt}`}
            onPress={() => {
              if (loc.ticketId > 0) router.push(`/ticket/${loc.ticketId}`);
            }}
            style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card }]}
            testID={`partner-map-row-${loc.employeeId}`}
          >
            <View style={[styles.dot, { backgroundColor: lifecycleColor(loc.lifecycleState) }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: colors.foreground }]}>{loc.employeeName}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, ...SCREEN_SUBTITLE_TEXT }}>
                {loc.vendorName ? `${loc.vendorName} · ` : ""}
                {loc.ticketId > 0 ? `#${loc.ticketId}` : ""}
                {loc.siteName ? ` · ${loc.siteName}` : ""}
                {loc.lifecycleState ? ` · ${loc.lifecycleState.replace(/_/g, " ")}` : ""}
              </Text>
            </View>
            <Feather
              name="navigation"
              size={20}
              color={colors.primary}
              onPress={(e) => {
                e.stopPropagation?.();
                openDirections(loc.latitude, loc.longitude);
              }}
            />
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  title: { fontFamily: "Inter_700Bold", fontSize: 22, marginBottom: 4, ...SCREEN_TITLE_TEXT },
  sub: { fontFamily: "Inter_400Regular", fontSize: 14, marginBottom: 12, ...SCREEN_SUBTITLE_TEXT },
  siteLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    ...SCREEN_SUBTITLE_TEXT,
  },
  siteSelect: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  siteSelectText: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    ...TEXT_SHADOW.content,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 24,
  },
  menuSheet: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    maxHeight: "70%",
  },
  menuTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 17,
    marginBottom: 12,
    ...SCREEN_TITLE_TEXT,
  },
  menuList: {
    maxHeight: 360,
  },
  menuOption: {
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuOptionText: {
    fontSize: 15,
    ...TEXT_SHADOW.content,
  },
  menuCancel: {
    alignItems: "center",
    paddingTop: 14,
  },
  mapWrap: { height: 320, borderRadius: 12, borderWidth: 1, overflow: "hidden", marginBottom: 16 },
  map: { flex: 1, backgroundColor: "#f3f4f6" },
  mapLoading: { flex: 1, alignItems: "center", justifyContent: "center" },
  section: { fontFamily: "Inter_600SemiBold", fontSize: 16, marginBottom: 8, ...SCREEN_TITLE_TEXT },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { fontFamily: "Inter_600SemiBold", fontSize: 15, ...TEXT_SHADOW.content },
  error: { marginBottom: 12, fontFamily: "Inter_400Regular" },
});
