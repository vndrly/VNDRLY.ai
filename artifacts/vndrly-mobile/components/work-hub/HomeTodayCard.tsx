import React from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";

type TodayKey = "calendar" | "work" | "attention" | "safety" | "tasks";

export type TodayCardRow = {
  key: TodayKey;
  label: string;
  value: string;
  onPress: () => void;
  expanded?: boolean;
};

function TodayIcon({
  kind,
  size = 19,
  color,
}: {
  kind: TodayKey | "sun" | "chevron";
  size?: number;
  color: string;
}) {
  const paths = {
    sun: (
      <>
        <Circle cx="12" cy="12" r="4" />
        <Path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41m14.14-14.14-1.41 1.41" />
      </>
    ),
    calendar: (
      <>
        <Path d="M8 2v4M16 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
        <Rect x="3" y="4" width="18" height="18" rx="2" />
      </>
    ),
    work: (
      <>
        <Path d="M12 6v6h4" />
        <Circle cx="12" cy="12" r="10" />
      </>
    ),
    attention: (
      <>
        <Path d="M10.268 21a2 2 0 0 0 3.464 0" />
        <Path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
      </>
    ),
    safety: (
      <Path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    ),
    tasks: (
      <>
        <Rect x="3" y="3" width="18" height="18" rx="2" />
        <Path d="m9 12 2 2 4-4" />
      </>
    ),
    chevron: <Path d="m9 18 6-6-6-6" />,
  };
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[kind]}
    </Svg>
  );
}

export default function HomeTodayCard({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: readonly TodayCardRow[];
}) {
  const { primary } = useColors();
  const expandedBackground = /^#[0-9a-f]{6}$/i.test(primary)
    ? `${primary}14`
    : "#283438";
  return (
    <View
      accessibilityLabel={title}
      style={{
        backgroundColor: "#242426",
        borderColor: primary,
        borderWidth: 2,
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingTop: 16,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 8,
          paddingBottom: 12,
        }}
      >
        <TodayIcon kind="sun" size={20} color={primary} />
        <View style={{ flex: 1 }}>
          <Text
            accessibilityRole="header"
            style={{ color: "#ececec", fontSize: 19, fontWeight: "700" }}
          >
            {title}
          </Text>
          <Text style={{ color: "#a3a3a3", fontSize: 12, marginTop: 2 }}>
            {subtitle}
          </Text>
        </View>
      </View>
      {rows.map((row) => (
        <Pressable
          key={row.key}
          accessibilityRole="button"
          accessibilityLabel={row.label}
          accessibilityState={
            row.expanded === undefined ? undefined : { expanded: row.expanded }
          }
          onPress={row.onPress}
          style={({ pressed }) => ({
            minHeight: 44,
            borderTopWidth: 1,
            borderTopColor: "#3a3a3a",
            flexDirection: "row",
            alignItems: "center",
            gap: 11,
            paddingVertical: 10,
            backgroundColor: row.expanded ? expandedBackground : "transparent",
            opacity: pressed ? 0.72 : 1,
          })}
        >
          <TodayIcon kind={row.key} color={primary} />
          <Text
            style={{
              color: "#ececec",
              fontSize: 15,
              fontWeight: "600",
              flex: 1,
            }}
          >
            {row.label}
          </Text>
          <Text
            style={{
              color: "#b3b3b3",
              fontSize: 13,
              textAlign: "right",
              maxWidth: "45%",
            }}
          >
            {row.value}
          </Text>
          <View
            style={
              row.expanded ? { transform: [{ rotate: "90deg" }] } : undefined
            }
          >
            <TodayIcon kind="chevron" size={18} color="#a3a3a3" />
          </View>
        </Pressable>
      ))}
    </View>
  );
}
