import { useMemo } from "react";

import colors from "@/constants/colors";
import { useBrand } from "@/hooks/use-brand";

export type AppColors = ReturnType<typeof useColors>;

/**
 * Returns design tokens for the current org-branded experience.
 *
 * The app is locked to the dark (Charcoal) palette regardless of the device's
 * reported color scheme. `primary`, `tint`, and `accentForeground` ALWAYS
 * derive from `brand.primary` — which already defaults to
 * `DEFAULT_BRAND_PRIMARY` when no partner brand is cached, so unbranded
 * sessions render the VNDRLY default exactly as before. This guarantees that
 * every text/icon/border that reads `colors.primary` flexes in lockstep with
 * the colored chrome that reads `brand.primary` directly (e.g.
 * `BrandColoredBg` in TogglePillButton, the EN/ES `LanguageToggle`). Without
 * this, an unauthenticated session with a hydrated partner brand (the
 * "previously logged in as Exxon" case) would render the pill buttons in
 * Exxon green but the "Sign up as a Vendor" link in default amber, drifting
 * the screen out of brand. `accent` stays gated on `isOrgBranded` because
 * that token has no neutral default — the dark palette's `accent` is the
 * intended fallback.
 *
 * Mirrors how the web app surfaces `--brand-primary` and `--brand-accent`
 * via CSS custom properties (see artifacts/vndrly/src/hooks/use-brand.tsx).
 */
export function useColors() {
  const brand = useBrand();
  return useMemo(() => {
    const base = colors.dark;
    return {
      ...base,
      primary: brand.primary,
      tint: brand.primary,
      accent: brand.isOrgBranded ? brand.accent : base.accent,
      accentForeground: brand.primary,
      radius: colors.radius,
    };
  }, [brand.primary, brand.accent, brand.isOrgBranded]);
}
