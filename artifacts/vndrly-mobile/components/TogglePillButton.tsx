import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type ImageSourcePropType,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useBrand } from "@/hooks/use-brand";

/**
 * # TogglePillButton (mobile) — the canonical VNDRLY pill button
 *
 * Mobile sibling of the web `TogglePillButton`. The web component
 * is **PNG image-asset rest → colored on hover** (the EN/ES
 * `LanguageToggle` swap). Mobile has no hover, so the colored
 * state activates on **press** instead — the touch is the
 * "active" half of the toggle.
 *
 * ## Doctrine
 *
 * - Rest: 3-sliced `inactive-grey.png` chrome (the canonical
 *   TogglePill rest sprite — has a baked-in gloss highlight and
 *   subtle bottom shadow that read as a real pill button, not a
 *   flat rectangle) with dark text. Used by the entire mobile
 *   pill family — AmberButton, BlueButton, Sign in to Portal,
 *   Continue as Visitor — so they all share one visual language.
 * - Pressed: the appropriate sliced colored sprite
 *   (amber for `brand`, blue, green, red) with white bold text
 *   and the `0 1px 2px rgba(0,0,0,0.55)` drop shadow that the
 *   web TogglePill uses for white-on-tonal legibility.
 * - `loading`: forces rest visuals + an `ActivityIndicator`.
 * - `disabled`: rest visuals at 50% opacity.
 * - `inactive`: forces rest visuals (no press-color reaction)
 *   for the dirty/disabled-form-step pattern in `login.tsx`.
 *
 * Color → semantic (matches the web doctrine in
 * `artifacts/vndrly/src/components/toggle-pill.tsx`):
 *
 * - `brand`  — partner brand-primary action (default amber on
 *              mobile since there's no per-partner branding yet).
 * - `blue`   — Edit / non-destructive primary.
 * - `green`  — ON / positive / confirm.
 * - `red`    — destructive / cancel-with-consequence.
 */

// 3-slice math for the legacy `inactive-grey.png` rest sprite. Same
// numbers the original AmberButton helper used so the rounded caps
// never squash at any pill width.
const INACTIVE_SRC_W = 144;
const INACTIVE_SRC_H = 36;
const INACTIVE_CAP_SRC_W = 20;

const inactiveSrc = require("../assets/buttons/inactive-grey.png");

/**
 * Per-color sprite triplet. The `brand` color is a flat
 * programmatic fill instead of a sprite (see `BrandColoredBg`)
 * so it can flex with the partner's `brand.primary` — Exxon
 * green for an Exxon employee, etc. — instead of being locked
 * to the amber asset color. The other (semantic-fixed) colors
 * keep their crafted PNG sprites.
 */
const COLOR_SPRITES: Record<
  Exclude<TogglePillColor, "brand">,
  { left: ImageSourcePropType; center: ImageSourcePropType; right: ImageSourcePropType }
> = {
  blue: {
    left: require("../assets/buttons/blue-left.png"),
    center: require("../assets/buttons/blue-center.png"),
    right: require("../assets/buttons/blue-right.png"),
  },
  green: {
    left: require("../assets/buttons/green-left.png"),
    center: require("../assets/buttons/green-center.png"),
    right: require("../assets/buttons/green-right.png"),
  },
  red: {
    left: require("../assets/buttons/red-left.png"),
    center: require("../assets/buttons/red-center.png"),
    right: require("../assets/buttons/red-right.png"),
  },
};

export type TogglePillColor = "brand" | "blue" | "green" | "red";

export interface TogglePillButtonProps {
  children: React.ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
  /** Pill height in pixels. Default 36 to match the legacy AmberButton/BlueButton default. */
  height?: number;
  /** Toggle color (semantic). Default "brand". */
  color?: TogglePillColor;
  /**
   * Force the rest (greyed) chrome regardless of press state.
   * Used by `login.tsx` to indicate a not-yet-ready form.
   */
  inactive?: boolean;
  /**
   * Force the colored chrome on at all times — i.e. render as a
   * permanent solid colored pill rather than the white-rest /
   * colored-press toggle. This is the legacy AmberButton /
   * BlueButton appearance and the canonical look for primary
   * CTAs ("Sign in to Portal", "Continue as Visitor", etc.) where
   * the button is an action, not a binary toggle.
   *
   * AmberButton and BlueButton wrappers default this to `true`
   * for legacy parity. Set explicitly to `false` to opt back
   * into the toggle behavior.
   */
  solid?: boolean;
}

/**
 * Sliced 3-section background renderer. Mirrors the proven
 * `InactiveSlicedBg` technique from the legacy `AmberButton`
 * so the rounded caps never squash at any width.
 */
function SlicedBg({
  height,
  left,
  center,
  right,
}: {
  height: number;
  left: ImageSourcePropType;
  center: ImageSourcePropType;
  right: ImageSourcePropType;
}) {
  return (
    <View style={styles.row}>
      <Image source={left} style={[styles.cap, { height }]} resizeMode="stretch" />
      <Image source={center} style={[styles.center, { height }]} resizeMode="stretch" />
      <Image source={right} style={[styles.cap, { height }]} resizeMode="stretch" />
    </View>
  );
}

/**
 * Programmatic colored pill background for the `brand` color.
 *
 * Mirrors the web TogglePillButton's hover-state visual: a solid
 * tonal fill (rounded-full, brand.primary) plus a 50% white
 * top-half linear-gradient gloss for the EN/ES highlight, plus a
 * 1px black/10 border. Using a flat View instead of a sprite is
 * what lets brand follow `brand.primary` so a logged-in Exxon
 * employee sees Exxon green here instead of the legacy amber.
 */
function BrandColoredBg({ height, color }: { height: number; color: string }) {
  return (
    <View
      style={[
        styles.brandFill,
        {
          height,
          borderRadius: height / 2,
          backgroundColor: color,
        },
      ]}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: height / 2,
          borderTopLeftRadius: height / 2,
          borderTopRightRadius: height / 2,
          backgroundColor: "rgba(255,255,255,0.5)",
        }}
      />
    </View>
  );
}

/**
 * Single-sprite (`inactive-grey.png`) rendered as a 3-slice
 * (cap-natural-cap) so the canonical TogglePill rest chrome —
 * with its baked-in gloss highlight and subtle bottom shadow —
 * stretches to any width without squashing the rounded caps.
 * Identical math to the legacy AmberButton helper.
 */
function SlicedSingleBg({ height, src }: { height: number; src: ImageSourcePropType }) {
  const capW = Math.round((height * INACTIVE_CAP_SRC_W) / INACTIVE_SRC_H);
  const fullScaledW = (capW * INACTIVE_SRC_W) / INACTIVE_CAP_SRC_W;
  const [centerW, setCenterW] = useState(0);
  const middleSrcW = INACTIVE_SRC_W - 2 * INACTIVE_CAP_SRC_W;
  const centerScaledW = centerW > 0 ? (centerW * INACTIVE_SRC_W) / middleSrcW : 0;
  const centerOffset = centerW > 0 ? -(centerScaledW * INACTIVE_CAP_SRC_W) / INACTIVE_SRC_W : 0;
  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ width: capW, height, overflow: "hidden" }}>
        <Image source={src} style={{ width: fullScaledW, height }} resizeMode="stretch" />
      </View>
      <View
        style={{ flex: 1, height, overflow: "hidden" }}
        onLayout={(e) => setCenterW(e.nativeEvent.layout.width)}
      >
        {centerW > 0 && (
          <Image
            source={src}
            style={{ width: centerScaledW, height, marginLeft: centerOffset }}
            resizeMode="stretch"
          />
        )}
      </View>
      <View style={{ width: capW, height, overflow: "hidden" }}>
        <Image
          source={src}
          style={{ width: fullScaledW, height, marginLeft: -(fullScaledW - capW) }}
          resizeMode="stretch"
        />
      </View>
    </View>
  );
}

export default function TogglePillButton({
  children,
  onPress,
  disabled,
  loading,
  style,
  textStyle,
  testID,
  height = 36,
  color = "brand",
  inactive,
  solid,
}: TogglePillButtonProps) {
  const brand = useBrand();
  const isDisabled = disabled || loading;
  const sprites = color === "brand" ? null : COLOR_SPRITES[color];
  // `inactive` and `loading` force the rest (grey) chrome regardless
  // of press state so a busy button never flashes its colored half.
  // `inactive` wins over `solid` so a not-yet-ready form CTA still
  // greys out the way callers expect.
  const lockToRest = !!inactive || !!loading;
  const lockToColored = !!solid && !lockToRest;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      testID={testID}
      style={({ pressed }) => [
        styles.container,
        {
          height,
          // Disabled buttons stay at 50% opacity unless they're in
          // the explicit `inactive` form-not-ready state, where the
          // grey chrome alone is the affordance and we don't want
          // to wash it out further.
          opacity: isDisabled && !inactive ? 0.5 : pressed ? 0.95 : 1,
        },
        style,
      ]}
    >
      {({ pressed }) => {
        // Solid mode (the legacy AmberButton/BlueButton CTAs) is
        // colored-at-rest, grey-on-press — pressing the chip swaps
        // ONLY the fill color from brand → grey. Same pill chrome,
        // same gloss, same hairline, same drop-shadow text — it's
        // the FILL that changes, not the silhouette. `loading`
        // (which wins via `lockToRest`) keeps the grey fill from
        // tap → async resolves → navigation.
        // Toggle mode (default `solid={false}`) keeps the canonical
        // TogglePill rest sprite at idle and swaps to the colored
        // BrandColoredBg on press.
        const showColored =
          !lockToRest && (lockToColored ? !pressed : pressed);
        const labelColor = showColored ? "#ffffff" : "#1a1d23";
        // For solid-mode brand pills, render BrandColoredBg in BOTH
        // states so only the fill color changes — never swap to the
        // sprite (which has different proportions and reads as a
        // different shape). Grey is `#9ca3af` (zinc-400), a neutral
        // mid-grey that's visibly distinct from the brand fill but
        // still matches the rest of the pill chrome.
        const renderBg = () => {
          // Solid-mode brand pills: ALWAYS render BrandColoredBg
          // regardless of pressed/loading/inactive state. The ONLY
          // thing that changes is the fill color: brand.primary at
          // rest, grey (#9ca3af) on press / loading / inactive.
          // The legacy SlicedSingleBg sprite is intentionally OUT
          // of this code path — it has different proportions and
          // reads as a different (square-ish) shape, and the user
          // wants the pill silhouette to be invariant.
          if (color === "brand" && solid) {
            const fillColor = showColored ? brand.primary : "#9ca3af";
            return <BrandColoredBg height={height} color={fillColor} />;
          }
          if (showColored) {
            return sprites ? (
              <SlicedBg
                height={height}
                left={sprites.left}
                center={sprites.center}
                right={sprites.right}
              />
            ) : (
              <BrandColoredBg height={height} color={brand.primary} />
            );
          }
          return <SlicedSingleBg height={height} src={inactiveSrc} />;
        };
        return (
          <>
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              {renderBg()}
            </View>
            <View style={styles.contentRow}>
              {loading ? (
                <ActivityIndicator color={labelColor} size="small" />
              ) : typeof children === "string" ? (
                <Text
                  style={[
                    styles.label,
                    { color: labelColor },
                    showColored ? styles.labelColoredShadow : null,
                    textStyle,
                  ]}
                  numberOfLines={1}
                >
                  {children}
                </Text>
              ) : (
                children
              )}
            </View>
          </>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
    paddingHorizontal: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  row: {
    flex: 1,
    flexDirection: "row",
  },
  cap: {
    width: 8,
  },
  center: {
    flex: 1,
  },
  contentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  labelColoredShadow: {
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  brandFill: {
    flex: 1,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.1)",
  },
  brandGloss: {
    ...StyleSheet.absoluteFillObject,
  },
});
