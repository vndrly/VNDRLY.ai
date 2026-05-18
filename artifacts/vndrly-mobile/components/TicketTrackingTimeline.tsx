import { Feather } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export type TimelineTrackingPoint = {
  id?: number | string;
  latitude: number;
  longitude: number;
  recordedAt?: string | Date | null;
};

type Props = {
  tracking?: TimelineTrackingPoint[];
  selectedTrackingId?: number | string | null;
  onSelectTracking?: (id: number | string | null) => void;
  maxHeight?: number;
  longStopThresholdMs?: number;
  fastSegmentThresholdMph?: number;
};

function isValidLatLng(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

const DEFAULT_LONG_DWELL_MS = 5 * 60 * 1000;
// 90 mph is well above legal highway speeds in most U.S. states; treat it as
// "almost certainly noise or unrealistic" so reviewers can spot it quickly.
const DEFAULT_FAST_MPH = 90;
// Below this distance the segment is shorter than typical GPS jitter
// (~8 meters), so we don't compute a meaningful speed for it.
const MIN_SEGMENT_MILES = 0.005;

function distanceMiles(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles.
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) *
      Math.cos(toRad(b.latitude)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(sa));
}

function formatDistance(miles: number): string {
  if (!Number.isFinite(miles) || miles < 0) return "0 ft";
  if (miles < 0.1) {
    const ft = Math.round(miles * 5280);
    return `${ft} ft`;
  }
  if (miles < 10) return `${miles.toFixed(2)} mi`;
  return `${miles.toFixed(1)} mi`;
}

function formatSpeed(mph: number): string {
  if (!Number.isFinite(mph) || mph < 0) return "0 mph";
  if (mph < 10) return `${mph.toFixed(1)} mph`;
  return `${Math.round(mph)} mph`;
}

function formatDwell(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

export function TicketTrackingTimeline({
  tracking,
  selectedTrackingId,
  onSelectTracking,
  maxHeight = 280,
  longStopThresholdMs = DEFAULT_LONG_DWELL_MS,
  fastSegmentThresholdMph = DEFAULT_FAST_MPH,
}: Props) {
  const colors = useColors();
  const { t } = useTranslation();
  const LONG_DWELL_MS = longStopThresholdMs;
  const FAST_MPH = fastSegmentThresholdMph;

  const sorted = useMemo(() => {
    if (!tracking || tracking.length === 0) return [];
    return tracking
      .filter((p) => isValidLatLng(p.latitude, p.longitude))
      .slice()
      .sort((a, b) => {
        const at = a.recordedAt ? new Date(a.recordedAt).getTime() : 0;
        const bt = b.recordedAt ? new Date(b.recordedAt).getTime() : 0;
        return at - bt;
      });
  }, [tracking]);

  // Per-point segment stats (distance, dwell, speed) since previous point.
  // Index 0 is null. Speed is null when the time gap is unknown / zero, or
  // when the segment is shorter than typical GPS jitter.
  const segments = useMemo(() => {
    return sorted.map((p, i) => {
      if (i === 0) return null;
      const prev = sorted[i - 1];
      const miles = distanceMiles(prev, p);
      const t = p.recordedAt ? new Date(p.recordedAt).getTime() : NaN;
      const pt = prev.recordedAt ? new Date(prev.recordedAt).getTime() : NaN;
      const ms =
        Number.isFinite(t) && Number.isFinite(pt) && t - pt >= 0 ? t - pt : null;
      let mph: number | null = null;
      if (ms != null && ms > 0 && miles >= MIN_SEGMENT_MILES) {
        mph = miles / (ms / 3_600_000);
      }
      return { miles, ms, mph };
    });
  }, [sorted]);

  if (sorted.length === 0) {
    return null;
  }

  return (
    <View
      style={[
        styles.container,
        { borderColor: colors.border, backgroundColor: colors.card },
      ]}
      testID="tracking-timeline"
    >
      <View
        style={[
          styles.header,
          { borderBottomColor: colors.border },
        ]}
      >
        <Text
          style={{
            color: colors.mutedForeground,
            fontSize: 11,
            fontFamily: "Inter_600SemiBold",
            letterSpacing: 0.5,
            textTransform: "uppercase",
          }}
        >
          {t("tracking.timelineTitle")}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {selectedTrackingId != null && onSelectTracking ? (
            <TouchableOpacity
              onPress={() => onSelectTracking(null)}
              hitSlop={6}
              testID="tracking-timeline-clear"
            >
              <Text style={{ color: colors.primary, fontSize: 12 }}>{t("tracking.clear")}</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
            {t("tracking.pointCount", { count: sorted.length })}
          </Text>
        </View>
      </View>
      <FlatList
        data={sorted}
        keyExtractor={(p, i) =>
          p.id != null ? String(p.id) : `${p.latitude}-${p.longitude}-${i}`
        }
        style={{ maxHeight }}
        nestedScrollEnabled
        ItemSeparatorComponent={() => (
          <View style={{ height: 1, backgroundColor: colors.border }} />
        )}
        renderItem={({ item: p, index: i }) => {
          const isSelected = p.id != null && p.id === selectedTrackingId;
          const recorded = p.recordedAt ? new Date(p.recordedAt) : null;
          const segment = segments[i];
          const isLongDwell =
            segment?.ms != null && segment.ms >= LONG_DWELL_MS;
          const isFastSegment =
            segment?.mph != null && segment.mph >= FAST_MPH;
          return (
            <TouchableOpacity
              onPress={() => {
                if (!onSelectTracking || p.id == null) return;
                onSelectTracking(isSelected ? null : p.id);
              }}
              activeOpacity={0.7}
              style={[
                styles.row,
                isSelected
                  ? {
                      backgroundColor: colors.accent,
                      borderLeftColor: colors.primary,
                    }
                  : { borderLeftColor: "transparent" },
              ]}
              testID={`tracking-timeline-item-${i}`}
              accessibilityState={{ selected: isSelected }}
            >
              <Feather
                name="map-pin"
                size={14}
                color={isSelected ? colors.primary : "#2563eb"}
                style={{ marginTop: 2 }}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                  }}
                >
                  <Text
                    style={{
                      color: colors.foreground,
                      fontSize: 12,
                      fontFamily: "Inter_600SemiBold",
                    }}
                  >
                    {t("tracking.pointLabel", { n: i + 1 })}
                  </Text>
                  {recorded ? (
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontSize: 11,
                      }}
                    >
                      {recorded.toLocaleTimeString()}
                    </Text>
                  ) : null}
                </View>
                {recorded ? (
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontSize: 11,
                    }}
                  >
                    {recorded.toLocaleDateString()}
                  </Text>
                ) : null}
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontSize: 11,
                  }}
                  numberOfLines={1}
                >
                  {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
                </Text>
                {segment ? (
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      alignItems: "center",
                      marginTop: 4,
                      columnGap: 8,
                      rowGap: 2,
                    }}
                    testID={`tracking-timeline-segment-${i}`}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 3,
                      }}
                      testID={`tracking-timeline-distance-${i}`}
                    >
                      <Feather
                        name="map-pin"
                        size={11}
                        color={colors.mutedForeground}
                      />
                      <Text
                        style={{
                          color: colors.mutedForeground,
                          fontSize: 11,
                        }}
                      >
                        {formatDistance(segment.miles)}
                      </Text>
                    </View>
                    {segment.ms != null ? (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 3,
                        }}
                        testID={`tracking-timeline-dwell-${i}`}
                      >
                        <Feather
                          name="clock"
                          size={11}
                          color={isLongDwell ? "#ea580c" : colors.mutedForeground}
                        />
                        <Text
                          style={{
                            color: isLongDwell ? "#ea580c" : colors.mutedForeground,
                            fontSize: 11,
                            fontFamily: isLongDwell
                              ? "Inter_600SemiBold"
                              : undefined,
                          }}
                        >
                          {formatDwell(segment.ms)}
                        </Text>
                      </View>
                    ) : null}
                    {segment.mph != null ? (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 3,
                        }}
                        testID={`tracking-timeline-speed-${i}`}
                      >
                        <Feather
                          name="zap"
                          size={11}
                          color={isFastSegment ? "#dc2626" : colors.mutedForeground}
                        />
                        <Text
                          style={{
                            color: isFastSegment ? "#dc2626" : colors.mutedForeground,
                            fontSize: 11,
                            fontFamily: isFastSegment
                              ? "Inter_600SemiBold"
                              : undefined,
                          }}
                        >
                          {formatSpeed(segment.mph)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderLeftWidth: 2,
  },
  empty: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    minHeight: 60,
  },
});
