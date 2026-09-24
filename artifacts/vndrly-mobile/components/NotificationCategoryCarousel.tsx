import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { REGULAR_NAVIGATION_BREAKPOINT } from "@/components/AdaptiveNavigationShell";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";

type Props = {
  categories: readonly string[];
  activeCategory: string;
  unread: Readonly<Record<string, number>>;
  /** Window width chooses the layout; onLayout measures the actual inbox viewport. */
  width: number;
  label: (category: string) => string;
  onSelect: (category: string) => void;
};

export default function NotificationCategoryCarousel({
  categories,
  activeCategory,
  unread,
  width,
  label,
  onSelect,
}: Props) {
  const colors = useColors();
  const compact = width < REGULAR_NAVIGATION_BREAKPOINT;
  const scroll = useRef<ScrollView>(null);
  const [viewport, setViewport] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [measurements, setMeasurements] = useState<
    Record<string, { x: number; width: number }>
  >({});
  const first = measurements[categories[0]];
  const last = measurements[categories[categories.length - 1]];
  const leading =
    compact && first ? Math.max(0, (viewport - first.width) / 2) : 0;
  const trailing =
    compact && last ? Math.max(0, (viewport - last.width) / 2) : 0;
  const center = useCallback(
    (id: string) => {
      const selected = measurements[id];
      if (!compact || !viewport || !first || !selected) return;
      scroll.current?.scrollTo({
        x: Math.max(
          0,
          leading + selected.x + selected.width / 2 - viewport / 2,
        ),
        animated: true,
      });
    },
    [compact, viewport, first, measurements, leading],
  );
  useEffect(() => {
    center(activeCategory);
  }, [activeCategory, center, contentWidth]);

  return (
    <View
      testID="notification-category-viewport"
      onLayout={(event) => setViewport(event.nativeEvent.layout.width)}
      style={styles.viewport}
    >
      <ScrollView
        ref={scroll}
        testID="notifications-category-row"
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEnabled={compact || contentWidth > viewport}
        onContentSizeChange={(value) => setContentWidth(value)}
        contentContainerStyle={styles.content}
      >
        {compact ? (
          <View
            testID="notification-category-leading-spacer"
            style={{ width: leading }}
          />
        ) : null}
        <View style={styles.row}>
          {categories.map((id) => (
            <View
              key={id}
              testID={`notification-category-measure-${id}`}
              style={styles.pillTarget}
              onLayout={({ nativeEvent: { layout } }) => {
                setMeasurements((current) =>
                  current[id]?.x === layout.x &&
                  current[id]?.width === layout.width
                    ? current
                    : {
                        ...current,
                        [id]: { x: layout.x, width: layout.width },
                      },
                );
              }}
            >
              <TogglePillButton
                color="brand"
                solid={activeCategory === id}
                inactive={activeCategory !== id}
                askVInactiveStyle
                accessibilityState={{ selected: activeCategory === id }}
                onPress={() => {
                  onSelect(id);
                  center(id);
                }}
                testID={`notifications-tab-${id}`}
              >
                {`${label(id)}${unread[id] > 0 ? ` (${unread[id]})` : ""}`}
              </TogglePillButton>
            </View>
          ))}
        </View>
        {compact ? (
          <View
            testID="notification-category-trailing-spacer"
            style={{ width: trailing }}
          />
        ) : null}
      </ScrollView>
      {compact ? (
        <>
          {(["left", "right"] as const).map((side) => (
            <View
              key={side}
              testID={`notification-category-fade-${side}`}
              pointerEvents="none"
              style={[styles.fade, { [side]: 0 }]}
            >
              <Svg width="100%" height="100%">
                <Defs>
                  <LinearGradient
                    id={`category-fade-${side}`}
                    x1="0"
                    x2="1"
                    y1="0"
                    y2="0"
                  >
                    <Stop
                      offset="0"
                      stopColor={colors.card}
                      stopOpacity={side === "left" ? 1 : 0}
                    />
                    <Stop
                      offset="1"
                      stopColor={colors.card}
                      stopOpacity={side === "left" ? 0 : 1}
                    />
                  </LinearGradient>
                </Defs>
                <Rect
                  width="100%"
                  height="100%"
                  fill={`url(#category-fade-${side})`}
                />
              </Svg>
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { flexGrow: 0, flexShrink: 0 },
  content: { alignItems: "center", paddingVertical: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  pillTarget: { minHeight: 44, justifyContent: "center" },
  fade: { position: "absolute", top: 0, bottom: 0, width: 20 },
});
