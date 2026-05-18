import React from "react";
import type { GestureResponderEvent, StyleProp, TextStyle, ViewStyle } from "react-native";
import TogglePillButton from "@/components/TogglePillButton";

/**
 * Legacy `AmberButton` import surface — preserved so the dozens of
 * existing call sites keep working unchanged. Internally this now
 * delegates to the canonical mobile `TogglePillButton` with the
 * brand color ("brand"), which on mobile defaults to amber
 * (`colors.primary` resolves to brand.primary, matching the web's
 * `DEFAULT_BRAND_PRIMARY`). New code SHOULD import
 * `TogglePillButton` directly.
 */
interface AmberButtonProps {
  children: React.ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
  height?: number;
  /**
   * Accepted for backwards compatibility but no-op under
   * TogglePillButton — the colored sprite is determined by the
   * `color` prop now. No call site in this repo currently passes
   * `tintColor`, so this only exists to keep the type compatible.
   */
  tintColor?: string;
  /** Forces the rest (greyed) chrome. */
  inactive?: boolean;
  /**
   * Forces the colored chrome on at all times. Defaults to `true`
   * for legacy parity — the original AmberButton was always amber,
   * not a press-only toggle. Pass `solid={false}` explicitly to
   * opt back into the white-rest / colored-press TogglePill
   * behavior.
   */
  solid?: boolean;
}

export default function AmberButton({
  tintColor: _tintColor,
  solid = true,
  ...props
}: AmberButtonProps) {
  return <TogglePillButton color="brand" solid={solid} {...props} />;
}
