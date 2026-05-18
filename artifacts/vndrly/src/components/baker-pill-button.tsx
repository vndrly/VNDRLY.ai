import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import PillBg from "@/components/pill-bg";
import { useBrand } from "@/hooks/use-brand";
// 2026-05-11: Baker assets refreshed at the user's direction. Every
// Baker-pinned slot in BakerPillButton now uses the new curated pair
// (teal active + light-grey v2r idle, square + Pill flavors). All
// callsites that pass `brandColor={brand.primary}` and rely on the
// Baker substitution automatically pick these up — no per-page work.
import bakerTeal from "@assets/NewPillPallet_0001s_0004_Layer-5.png";
import bakerGrey from "@assets/900x229_Light-grey_v2r_square_1778508315270.png";
// `idleVariant="grey-modal"` shares the same new square idle PNG —
// the previous distinction was about which generation of asset to
// show; with the refresh both modes converge on the v2r square.
import bakerGreyModal from "@assets/900x229_Light-grey_v2r_square_1778508315270.png";
// Baker-only global substitutes. When the active brand is Baker, ANY
// BakerPillButton that would normally pick its active pill via the
// `pickPillForBrand` matcher (i.e. `brandColor` is non-null and no
// explicit `activeSrc` override is supplied) renders this teal pill
// instead, and the `idleVariant="grey"` idle layer renders this grey
// pill. Other brands (and unbranded VNDRLY) are unaffected.
import bakerBrandActive from "@assets/NewPillPallet_0001s_0004_Layer-5.png";
import bakerBrandIdleGrey from "@assets/900x229_Light-grey_v2r_Pill_1778508294450.png";
// SQUARE-shape variants (legacy palette name kept as `pill*` because
// these power BakerPillButton's vendor-portal CTA which is rounded
// via the PillBg mask — but the source PNGs themselves are the
// "square" assets). Used when the substituted surface was originally
// a square asset.
import pillRed from "@assets/900x229_red_square_v4_1778219781877.png";
import pillAmber from "@assets/900x229_Amber_squarel_v3_1778219898400.png";
import pillTan from "@assets/900x229_tan_square-v2_1778219781879.png";
import pillLime from "@assets/900x229_lime_green_square_v3_1778219898401.png";
import pillGreen from "@assets/900x229_green_square_v3_1778219781879.png";
import pillDarkGreen from "@assets/900x229_dark_green_square_1778219781877.png";
import pillTeal from "@assets/900x229_teal_square_1778219898402.png";
import pillBlue from "@assets/900x229_dark_blue_square-v2_1778219898401.png";
import pillPurple from "@assets/900x229_purple_square_v2_1778219781876.png";
import pillHotPink from "@assets/900x229_hot-pink_square-v2l_1778219898403.png";
import pillPink from "@assets/900x229_pink_square_1778219781876.png";
import pillGrey from "@assets/900x229_grey_square_1778219781880.png";
// PILL-shape variants. Used when the substituted surface was
// originally a Pill asset (e.g. the Baker sidebar nav button uses
// `900x229_baker_teal_Pill_*`, so its non-Baker substitutes must
// also be Pill PNGs — pill-for-pill substitution doctrine).
import pillShapeRed from "@assets/900x229_red_Pill_v2_1777847855327.png";
import pillShapeAmber from "@assets/900x229_Amber_Pill_v4_1777847122888.png";
import pillShapeTan from "@assets/NewPillPallet_0001s_0030_900x229_tan_Pill.png";
import pillShapeGreen from "@assets/NewPillPallet_0001s_0051_900x229_green_Pill_v3.png";
import pillShapeDarkGreen from "@assets/900x229_dark_green_Pill_v3_1777847855320.png";
import pillShapeBlue from "@assets/NewPillPallet_0001s_0017_900x229_blue_Pill.png";
import pillShapePurple from "@assets/900x229_purple_Pill_v2_1777847855326.png";
import pillShapeHotPink from "@assets/900x229_hot_pink_Pill_1777847855324.png";
import pillShapePink from "@assets/900x229_pink_Pill_v2_1777847855326.png";
import pillShapeGrey from "@assets/900x229_Grey_Pill_1777067745193.png";

const BAKER_ASPECT = 900 / 229;

type PaletteEntry = { hex: string; src: string };

// Curated brand-active SQUARE palette — one canonical PNG per hue
// family, picked from the saturated variants so the active/hover
// state has the strongest possible visual punch. Used when a partner
// brand color is active on a surface whose original asset is a
// "square" PNG.
const BRAND_SQUARE_PALETTE: PaletteEntry[] = [
  { hex: "#D80B0B", src: pillRed },
  { hex: "#F39C1A", src: pillAmber },
  { hex: "#B89C3A", src: pillTan },
  { hex: "#6EB13B", src: pillLime },
  { hex: "#149F3D", src: pillGreen },
  { hex: "#1F7A47", src: pillDarkGreen },
  { hex: "#4A8FAF", src: pillTeal },
  { hex: "#00ADB5", src: bakerTeal },
  { hex: "#1E5BD0", src: pillBlue },
  { hex: "#6B1FB8", src: pillPurple },
  { hex: "#D62598", src: pillHotPink },
  { hex: "#DB1E5C", src: pillPink },
];

// Parallel PILL palette — same hue families, but using the PILL-shape
// PNGs so a substitution onto a surface that was originally a Pill
// asset stays a Pill (pill-for-pill / square-for-square doctrine).
// `lime` collapses onto the green Pill since there is no dedicated
// lime Pill in attached_assets/.
const BRAND_PILL_PALETTE: PaletteEntry[] = [
  { hex: "#D80B0B", src: pillShapeRed },
  { hex: "#F39C1A", src: pillShapeAmber },
  { hex: "#B89C3A", src: pillShapeTan },
  { hex: "#6EB13B", src: pillShapeGreen },
  { hex: "#149F3D", src: pillShapeGreen },
  { hex: "#1F7A47", src: pillShapeDarkGreen },
  { hex: "#00ADB5", src: bakerTeal },
  { hex: "#1E5BD0", src: pillShapeBlue },
  { hex: "#6B1FB8", src: pillShapePurple },
  { hex: "#D62598", src: pillShapeHotPink },
  { hex: "#DB1E5C", src: pillShapePink },
];

// Neutral fallbacks for very-low-saturation brand colors — one per
// shape so the substitution doctrine still holds.
const NEUTRAL_SQUARE_SRC = pillGrey;
const NEUTRAL_PILL_SRC = pillShapeGrey;

export type PillShape = "square" | "pill";
function isWinchesterBrand(brandName: string | null | undefined): boolean {
  return !!brandName?.toLowerCase().includes("winchester");
}

function hexToRgb(hex: string): [number, number, number] | null {
  const cleaned = hex.trim().replace(/^#/, "");
  const full =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rgbToHsl(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return d > 180 ? 360 - d : d;
}

/**
 * Pick the best-matching active-state PNG for a given brand color.
 * Honors the pill-for-pill / square-for-square substitution doctrine:
 * pass `shape="pill"` when the surface being substituted originally
 * used a Pill PNG, `shape="square"` (default for back-compat) when it
 * used a square PNG. Returns the Baker teal pill when no usable color
 * is supplied, the neutral grey asset (matching `shape`) for
 * very-low-saturation inputs, and otherwise the palette entry with
 * the smallest hue-weighted HSL distance.
 */
export function pickPillForBrand(
  brandColor: string | null | undefined,
  shape: PillShape = "square",
  brandName?: string | null,
): string {
  if (isWinchesterBrand(brandName)) return pillShapeTan;
  const palette = shape === "pill" ? BRAND_PILL_PALETTE : BRAND_SQUARE_PALETTE;
  const neutral = shape === "pill" ? NEUTRAL_PILL_SRC : NEUTRAL_SQUARE_SRC;
  if (!brandColor) return bakerTeal;
  const rgb = hexToRgb(brandColor);
  if (!rgb) return bakerTeal;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  if (s < 0.12) return neutral;
  let bestSrc = palette[0].src;
  let bestScore = Infinity;
  for (const entry of palette) {
    const erRgb = hexToRgb(entry.hex);
    if (!erRgb) continue;
    const [eh, es, el] = rgbToHsl(erRgb[0], erRgb[1], erRgb[2]);
    // Hue weighted heaviest, then saturation, then lightness.
    const score =
      (hueDistance(h, eh) / 180) * 3 +
      Math.abs(s - es) * 1 +
      Math.abs(l - el) * 0.5;
    if (score < bestScore) {
      bestScore = score;
      bestSrc = entry.src;
    }
  }
  return bestSrc;
}

export default function BakerPillButton({
  children,
  onClick,
  type = "button",
  disabled = false,
  testId,
  className = "",
  height = 24,
  fullWidth = true,
  idleVariant = "teal",
  brandColor = null,
  attention = false,
  activeSrc: activeSrcOverride,
  idleSrc: idleSrcOverride,
  idleOpacity,
  style,
  labelClass,
  activeFadesIn = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  testId?: string;
  className?: string;
  height?: number;
  fullWidth?: boolean;
  idleVariant?: "teal" | "grey" | "grey-modal";
  /**
   * Optional partner/vendor brand color (hex). When supplied, the
   * active/hover layer swaps from Baker teal to the closest-matching
   * pill from BRAND_PILL_PALETTE. Pass `null` (or omit) to keep the
   * Baker teal default — used on unbranded surfaces.
   */
  brandColor?: string | null;
  /**
   * When true, auto-pulse the idle layer's opacity on a 700 ms cadence
   * so the button alternates between its grey idle state and its
   * colored hover state — used to flag dirty-form "Save Changes"
   * actions. Disabled while `disabled` is true.
   */
  attention?: boolean;
  /**
   * Hard-pin overrides. When provided, completely bypass
   * `pickPillForBrand` / `idleVariant` resolution and render exactly
   * the supplied PNG(s). Used when a callsite needs an explicit pair
   * of pill assets (e.g. the vendor login portal Sign In to Portal /
   * Continue as Visitor buttons) regardless of brand color.
   */
  activeSrc?: string;
  idleSrc?: string;
  /**
   * Optional resting opacity for the idle layer (0–1). Defaults to 1.
   * Pass 0.5 to mimic the TogglePillButton/Bulk Upload Logins idle
   * treatment where `pillBase` renders at 50% opacity over the active
   * colored layer. The hover/active fade-to-0 still applies.
   */
  idleOpacity?: number;
  style?: React.CSSProperties;
  /**
   * Optional class merged onto the outer label span. Use to override
   * the default `text-sm` / `px-5` sizing — e.g. pass
   * `"text-xs px-3"` to match the smaller TogglePillButton lettering
   * used on Bulk Upload Logins.
   */
  labelClass?: string;
  /**
   * When true, the active (colored) layer starts at opacity 0 and
   * fades in on hover — mirroring TogglePillButton's behavior. This
   * lets the idle layer render at <100% opacity (e.g. 0.5 to match
   * Bulk Upload Logins) without the colored layer bleeding through
   * at rest. Defaults to false (legacy: active always fully opaque).
   */
  activeFadesIn?: boolean;
}) {
  const brand = useBrand();
  const isBaker = !!brand.name?.toLowerCase().includes("baker");
  // Baker substitutes ONLY swap in when the callsite would have used
  // the matcher (brandColor != null) and didn't already hard-pin via
  // `activeSrc`. This preserves: login's hard-pinned login-pair PNGs,
  // vendor-detail Save Changes (which passes brandColor={null} for
  // Baker → already gets bakerTeal default), and every non-Baker
  // brand's matcher-driven active pill.
  // Square-for-square: the Baker hard-pinned `bakerBrandActive` asset
  // is visually a square (despite "Pill" in its filename), so the
  // non-Baker substitute must also come from the square palette.
  const matchedActiveSrc = pickPillForBrand(brandColor, "square", brand.name);
  const useBakerActiveOverride =
    isBaker && !activeSrcOverride && brandColor != null;
  const activeSrc =
    activeSrcOverride ??
    (useBakerActiveOverride ? bakerBrandActive : matchedActiveSrc);
  const useBakerGreyOverride =
    isBaker && !idleSrcOverride && idleVariant === "grey";
  const resolvedIdleSrc =
    idleSrcOverride ??
    (idleVariant === "grey-modal"
      ? bakerGreyModal
      : idleVariant === "grey"
        ? useBakerGreyOverride
          ? bakerBrandIdleGrey
          : bakerGrey
        : activeSrc);
  const idleSrc = resolvedIdleSrc;
  const [pulseOn, setPulseOn] = useState(false);
  useEffect(() => {
    if (!attention || disabled) {
      setPulseOn(false);
      return;
    }
    const id = setInterval(() => setPulseOn((p) => !p), 700);
    return () => clearInterval(id);
  }, [attention, disabled]);
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        "relative cursor-pointer group select-none inline-flex items-center justify-center",
        "transition-transform active:scale-[0.99]",
        "disabled:cursor-not-allowed",
        fullWidth ? "w-full" : "",
        className,
      )}
      style={{ height, padding: 0, background: "transparent", border: 0, ...style }}
    >
      <PillBg
        src={activeSrc}
        imageAspect={BAKER_ASPECT}
        className={cn(
          activeFadesIn &&
            "opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-active:opacity-100",
          activeFadesIn && pulseOn && "opacity-100",
        )}
      />
      <PillBg
        src={idleSrc}
        imageAspect={BAKER_ASPECT}
        className={cn(
          "opacity-90 transition-opacity duration-200 group-hover:opacity-0 group-active:opacity-0 group-disabled:!opacity-100",
          pulseOn && "opacity-0",
        )}
        style={idleOpacity != null ? { opacity: idleOpacity } : undefined}
      />
      <span
        className={cn(
          "relative z-10 inline-flex items-center justify-center gap-1.5 px-5 h-full",
          "text-sm font-bold whitespace-nowrap",
          "transition-transform group-hover:scale-[1.01]",
          labelClass,
        )}
      >
        <span
          className={cn(
            "inline-flex items-center justify-center gap-1.5",
            "transition-opacity duration-200 text-gray-800/85",
            "group-hover:opacity-0 group-active:opacity-0",
            "group-disabled:!opacity-100",
            pulseOn && "opacity-0",
          )}
        >
          {children}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-0 inline-flex items-center justify-center gap-1.5 px-5",
            "opacity-0 transition-opacity duration-200 text-white",
            "drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]",
            "group-hover:opacity-100 group-active:opacity-100",
            "group-disabled:!opacity-0",
            pulseOn && "opacity-100",
          )}
        >
          {children}
        </span>
      </span>
    </button>
  );
}
