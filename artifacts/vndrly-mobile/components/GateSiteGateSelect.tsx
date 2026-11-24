import { ModalPressable as Pressable, ModalTextInput as TextInput } from "@/components/ModalDraft";
import DismissibleModal from "@/components/DismissibleModal";
import React, { useId, useState } from "react";
import {
  Platform,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Feather } from "@expo/vector-icons";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { evaluateGpsFence } from "@workspace/gate-booth";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { changeOverRequest } from "@/lib/change-over-api";

type Choice = {
  id: string;
  name: string;
  siteId: number;
  latitude?: number | null;
  longitude?: number | null;
  siteLatitude?: number | null;
  siteLongitude?: number | null;
  geofenceRadiusM?: number | null;
};
export default function GateSiteGateSelect({
  sites,
  siteId,
  gate,
  onChange,
  origin,
  allOptionLabel,
  compact = false,
  wide = false,
  gateOptions,
  stationOnly = false,
  gpsStatus,
  gpsLabel,
  gpsDetail,
}: {
  sites: { id: number; name: string }[];
  siteId?: number;
  gate?: { id: string; name: string };
  onChange: (siteId: number, gateId: string) => void;
  origin?: { latitude: number; longitude: number } | null;
  allOptionLabel?: string;
  compact?: boolean;
  wide?: boolean;
  gateOptions?: Choice[];
  stationOnly?: boolean;
  gpsStatus?: "verified" | "mismatch" | "unavailable";
  gpsLabel?: string;
  gpsDetail?: string;
}) {
  const { user } = useAuth(),
    colors = useColors(),
    { t } = useTranslation();
  const [search, setSearch] = useState("");
  const viewport = useWindowDimensions(),
    [open, setOpen] = useState(false),
    gradient = useId();
  const tablet =
    Platform.OS === "ios" ? Platform.isPad === true : viewport.width >= 768;
  const label = `${t("changeOver.site")} | ${t("changeOver.gate")}`;
  const query = useQuery({
    queryKey: [
      "gate-site-gate-options",
      user?.id,
      user?.activeMembershipId,
      user?.vendorId,
      user?.partnerId,
    ],
    queryFn: () => changeOverRequest<{ gates: Choice[] }>("/map"),
    enabled: sites.length > 0 && !gateOptions,
    retry: false,
  });
  const choices = [...(gateOptions ?? query.data?.gates ?? [])].filter((row) =>
    sites.some((site) => site.id === row.siteId),
  );
  if (gate && siteId && !choices.some((row) => row.id === gate.id))
    choices.push({ ...gate, siteId });
  const linked = useQuery({
    queryKey: ["linked-gates", user?.id, user?.activeMembershipId, siteId],
    queryFn: () =>
      changeOverRequest<{
        groupId: string | null;
        gates: { id: string; active: boolean; connection: string }[];
      }>("/linked-gates?siteId=" + siteId),
    enabled: !!siteId && !stationOnly,
    retry: false,
    refetchInterval: 30000,
  });
  const linkedOnline = linked.data?.gates?.some(
    (g) => g.id !== gate?.id && g.active && g.connection === "online",
  );
  const current = choices.find((row) => row.id === gate?.id);
  const site = sites.find((row) => row.id === siteId);
  const latitude = current?.latitude ?? current?.siteLatitude,
    longitude = current?.longitude ?? current?.siteLongitude;
  const fence = evaluateGpsFence({
    gps: origin ? "locked" : "unavailable",
    origin: origin ?? null,
    site:
      latitude != null && longitude != null
        ? {
            latitude,
            longitude,
            siteRadiusMeters: current?.geofenceRadiusM ?? 500,
          }
        : null,
  });
  const computedStatus =
    fence.milesToSite == null
      ? "unavailable"
      : fence.insideFence
        ? "verified"
        : "mismatch";
  const endpoint =
    (gpsStatus ?? computedStatus) === "verified"
      ? "#22c55e"
      : (gpsStatus ?? computedStatus) === "mismatch"
        ? "#ef4444"
        : "#9ca3af";
  const text = !gate && allOptionLabel ? allOptionLabel : site
    ? stationOnly ? gate?.name ?? t("gatekeeper.selectGateLocation") : `${site.name} | ${gate?.name ?? t("gatekeeper.selectGateLocation")}`
    : t("changeOver.choose");
  return (
    <View
      testID="site-gate-control"
      style={{ width: compact || wide ? "100%" : 375, maxWidth: "100%", alignSelf: "center", gap: compact ? 2 : 4 }}
    >
      <Text
        style={{
          textAlign: "center",
          color: colors.foreground,
          fontSize: compact ? 12 : 14,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${text}. ${gpsLabel ?? ""}`}
          accessibilityHint={gpsDetail || gpsLabel || undefined}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(true)}
          testID="site-gate-selector"
          style={{
            minHeight: compact ? 34 : 44,
            borderWidth: 2,
            borderColor: colors.primary,
            borderRadius: 22,
            paddingHorizontal: 12,
            justifyContent: "center",
          }}
        >
          {!stationOnly && linked.data?.groupId && (
            <Feather
              name="link"
              size={18}
              color={linkedOnline ? "#22c55e" : "#9ca3af"}
              accessibilityLabel={
                linkedOnline
                  ? "Linked gate online"
                  : "Linked gates inactive or disconnected"
              }
              style={{ position: "absolute", left: 8 }}
            />
          )}
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{
              color: colors.foreground,
              paddingLeft: !stationOnly && linked.data?.groupId ? 22 : 0,
              paddingRight: 12,
            }}
          >
            {text}
          </Text>
          <Text
            accessible={false}
            style={{ position: "absolute", right: 10, color: colors.primary }}
          >
            ⌄
          </Text>
        </Pressable>
        <Svg
          pointerEvents="none"
          width={32}
          height={52}
          viewBox="0 0 32 52"
          style={{ position: "absolute", right: -10, top: -4 }}
        >
          <Defs>
            <LinearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#f59e0b" />
              <Stop offset="100%" stopColor={endpoint} />
            </LinearGradient>
          </Defs>
          <Path
            d="M 5 4 A 22 22 0 0 1 5 48"
            fill="none"
            stroke="#151719"
            strokeWidth={8}
            strokeLinecap="round"
          />
          <Path
            d="M 5 4 A 22 22 0 0 1 5 48"
            fill="none"
            stroke={`url(#${gradient})`}
            strokeWidth={5}
            strokeLinecap="round"
          />
        </Svg>
      </View>
      <DismissibleModal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          accessibilityLabel={t("common.close")}
          onPress={() => setOpen(false)}
          style={{
            flex: 1,
            backgroundColor: "#0008",
            padding: 24,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <View
            style={{
              width: 375,
              maxWidth: "100%",
              maxHeight: "70%",
              borderRadius: 12,
              backgroundColor: colors.card,
              padding: 12,
            }}
          >
            <Text
              style={{
                color: colors.foreground,
                textAlign: "center",
                fontWeight: "700",
                padding: 8,
              }}
            >
              {label}
            </Text>
            <TextInput
              accessibilityLabel="Search sites and gates"
              placeholder="Search sites and gates"
              placeholderTextColor={colors.mutedForeground}
              value={search}
              onChangeText={setSearch}
              style={{
                minHeight: 44,
                color: colors.foreground,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 10,
                borderRadius: 8,
              }}
            />
            {!gateOptions && query.isError && (
              <Pressable
                accessibilityRole="button"
                onPress={() => void query.refetch()}
              >
                <Text style={{ color: colors.destructive, padding: 12 }}>
                  {query.error.message} ·{" "}
                  {t("common.retry", { defaultValue: "Retry" })}
                </Text>
              </Pressable>
            )}
            <ScrollView>
              {allOptionLabel && <Pressable accessibilityRole="button" onPress={() => { onChange(0, ""); setOpen(false); }} style={{ minHeight: 44, justifyContent: "center", padding: 10 }}><Text style={{ color: !gate ? colors.primary : colors.foreground }}>{allOptionLabel}</Text></Pressable>}
              {choices
                .filter((row) =>
                  (
                    row.name +
                    " " +
                    sites.find((site) => site.id === row.siteId)?.name
                  )
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((row) => (
                  <Pressable
                    key={row.id}
                    accessibilityRole="button"
                    onPress={() => {
                      onChange(row.siteId, row.id);
                      setOpen(false);
                    }}
                    style={{
                      minHeight: 44,
                      justifyContent: "center",
                      padding: 10,
                    }}
                  >
                    <Text
                      style={{
                        color:
                          row.id === gate?.id
                            ? colors.primary
                            : colors.foreground,
                      }}
                    >
                        {stationOnly ? row.name : `${sites.find((site) => site.id === row.siteId)?.name} | ${row.name}`}
                    </Text>
                  </Pressable>
                ))}
            </ScrollView>
          </View>
        </Pressable>
      </DismissibleModal>
    </View>
  );
}
