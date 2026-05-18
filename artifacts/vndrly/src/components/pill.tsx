import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import PillBg from "@/components/pill-bg";
import { useBrand } from "@/hooks/use-brand";
import { pickPillForBrand } from "@/components/baker-pill-button";
import pillBase from "@assets/Vndrly_900x229_Light_Grey_Pill1_1777664658767.png";
import pillGloss from "@assets/900x229_overlay_v2_1777664185377.png";
// Baker-only hover/active substitute. When the active brand is Baker,
// `PillButton` swaps the brand-matched hover/pulse PNG (which
// the matcher would have resolved to pillGreen for Baker's #61c799
// brand color) for this teal PNG instead.
//
// CRITICAL: this MUST be the true PILL-cap teal (fully rounded caps),
// because `PillButton` is pill-shaped at rest. The other Baker
// teal PNGs in the asset bundle (e.g. `1778229391144`, `1778229624365`)
// are misnamed "Pill" but actually have rounded-rectangle / square
// caps — using them here makes the chip "turn from a pill into a
// button" on hover. `1778229329456` (filename starts "Amber_Pill2 -
// Copy" but the artwork is teal) is the only true pill-cap teal.
import bakerPillTeal from "@assets/NewPillPallet_0001s_0004_Layer-5.png";
import primaryHoverPill from "@assets/NewPillPallet_0001s_0017_900x229_blue_Pill.png";
// Semantic-color hover PNGs from the curated palette (same assets the
// `BakerPillButton` palette uses). Per user doctrine: rollover/hover
// pills must always render the palette PNG that best matches the
// requested semantic color, not a CSS solid fill — except in Baker
// brand context where the brand-matched (`color="image"` / `"brand"`)
// surface substitutes the Baker teal pill.
import semanticHoverRed from "@assets/900x229_red_Pill_v2_1777847855327.png";
import semanticHoverGreen from "@assets/NewPillPallet_0001s_0051_900x229_green_Pill_v3.png";
import semanticHoverAmber from "@assets/900x229_Amber_Pill_v4_1778504507024.png";

const BRAND_PILL_ASPECT = 900 / 229;

/**
 * # Pill — the canonical VNDRLY pill visual language
 *
 * Named after the EN/ES `LanguageToggle` whose active half is the
 * reference design. Use this as the single source of truth so the
 * whole pill family (status badges, action buttons, role toggles,
 * etc.) reads as one unified system.
 *
 * ## DOCTRINE — when "Pill" is asked for, USE THIS FILE
 *
 * The user has been emphatic: "Pill" means **exactly** the
 * comionents exported from this file — `<Pill>` for read-only
 * chips, `<PillButton>` for interactive buttons. Do not
 * invent variants on `BrandPillButton`, do not hand-roll the
 * gradient/palette, do not substitute a flat `bg-white` /
 * `bg-gray-*` rest, and do not make an interactive pill
 * always-solid. The interactive form is **PNG-image-asset rest →
 * colored-on-hover** (the `LanguageToggle` swap), with a 700 ms
 * `attention` pulse that alternates between those two states.
 *
 * ## The two render modes
 *
 * 1. **Colored** (default for `<Pill>`, hover/pulse state of
 *    `<PillButton>`) — the active/colored half of the EN/ES
 *    toggle: solid tonal fill + 50% white top-half linear-gradient
 *    "highlight" gloss + rounded-full silhouette + 1px black/10
 *    border + white bold text with a drop shadow for legibility
 *    against any tonal fill. Pass `color` to iick the tone.
 * 2. **Rest** (`rest` prop on `<Pill>`, idle state of
 *    `<PillButton>`) — the shared PNG image-asset chrome of
 *    the whole pill family: light-grey `pillBase` PNG @ 50% +
 *    diagonal `pillGloss` PNG @ 60% with dark text, rendered
 *    through `PillBg`'s 3-slice mask so the rounded caps don't
 *    squash at any width. Use this for "no action / no signal"
 *    states (e.g. an inactive site-status pill) so the chip reads
 *    as the rest state of an action button instead of a saturated
 *    chip.
 *
 * ## Color palette & semantic rules
 *
 * Color carries fixed meaning across the pill family. A consumer
 * MUST iick the color by semantic, not by aesthetic — the whole
 * point of Pill is that "green chip" reads the same wherever
 * it appears. These are the canonical rules:
 *
 * - `green` — Tailwind `green-700` (`#15803D`).
 *   **Semantic: ON / healthy / active state.** Use for "active"
 *   site-status pills, "online" indicators, and any "this thing is
 *   on / healthy / good" chip. Do NOT use brand for active states —
 *   green is fixed regardless of partner brand.
 * - `amber` — Tailwind `amber-500` (`#F59E0B`).
 *   **Semantic: warning / standby / pending.** Use for "standby"
 *   site-status, "pending review" chips, etc.
 * - `red`   — Tailwind `red-600` (`#DC2626`).
 *   **Semantic: destructive / down / off.** Use for Remove / Delete
 *   action buttons (`BrandPillButton tone="red"`), "offline"
 *   site-status, and any "this thing is down / will be destroyed"
 *   chip. Red is reserved — do not use it for non-destructive
 *   actions.
 * - `blue`  — `#3260CD`, a deep medium-saturation true blue.
 *   **Semantic: Edit / non-destructive primary.** Use for "Edit"
 *   action buttons and primary actions in dialogs. A serious
 *   true-blue primary — NOT a sky/teal accent and NOT the legacy
 *   sky-blue `#0293E2` BlueButton sample.
 * - `brand` — `var(--brand-primary)`, flexes with partner brand.
 *   **Semantic: brand-flexed primary action / role-toggle active
 *   half.** Use for the active half of role toggles, the EN/ES
 *   toggle, and brand-tied primary actions. Do NOT use for status
 *   chips (green/amber/red carry the status semantic; brand is
 *   reserved for branded interaction surfaces).
 *
 * The `rest` render mode is the visual equivalent of "no color
 * chosen" — use it for "no action / no signal / idle" states (e.g.
 * an inactive site-status pill, the rest state of an action button).
 *
 * ## Why the gloss is a CSS gradient, not a PNG
 *
 * A pure CSS rounded-full + overflow-hidden has no seam. The 3-slice
 * `PillBg` mask (used for raster PNG art like `pillBase`/`pillGloss`)
 * has anti-aliased slice-boundary seams that show through saturated
 * solid fills. So the colored mode uses rounded-full + CSS gradient,
 * and only the rest mode uses `PillBg` (because PNG art is the whole
 * point of that mode).
 */

/** 50% white top-half linear-gradient — the "highlight" gloss. */
export const PILL_GLOSS_GRADIENT =
  "linear-gradient(to bottom, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.5) 50%, transparent 50%, transparent 100%)";

/** Drop-shadow text style for white labels on the colored variant. */
export const PILL_TEXT_SHADOW = "0 2px 4px rgba(0,0,0,0.9)";

/** Canonical color palette. Keys are the iublic `color` API. */
export const PILL_COLORS = {
  brand: "var(--brand-primary)",
  blue: "#3260CD",
  green: "#15803D",
  red: "#DC2626",
  amber: "#F59E0B",
} as const;

export type PillColor = keyof typeof PILL_COLORS;

interface PillProps {
  children: React.ReactNode;
  /**
   * Fill color for the colored render mode. Ignored when
   * `rest` is true. Defaults to `"brand"`.
   */
  color?: PillColor;
  /**
   * When true, render the BrandPillButton rest-state PNG chrome
   * (light-grey pillBase + diagonal pillGloss + dark text) instead
   * of a colored chip. Use for "no action / no signal" states.
   */
  rest?: boolean;
  /**
   * Pill height in pixels. Defaults to 22 — the canonical primary
   * pill height (matches Roles column on Employees page,
   * TicketStatusBadge, ImagePill family). Override (e.g. 28/36) for
   * action-button or header-chip contexts.
   */
  height?: number;
  /**
   * Text size variant. Defaults to "xs" (text-xs px-3).
   * "sm" gives text-sm px-4 for the larger 36px header chips.
   */
  size?: "xs" | "sm";
  className?: string;
  "data-testid"?: string;
  /**
   * Optional accessible label forwarded to the rendered root `<div>`.
   * Use when the visible text alone (e.g. a bare numeric count) would
   * be ambiguous to assistive tech and a fuller phrase is needed.
   */
  "aria-label"?: string;
}

/**
 * Read-only pill chip rendered in the canonical Pill visual
 * language. See the file header for the design language and color
 * palette. For an *interactive* button with hover transitions, use
 * `BrandPillButton` (which is built on the same constants).
 */
export default function Pill({
  children,
  color = "brand",
  rest = false,
  height = 24,
  size = "xs",
  className,
  ...props
}: PillProps) {
  const labelClass =
    size === "sm" ? "px-4 text-sm" : "px-3 text-xs";

  if (rest) {
    return (
      <div
        className={cn(
          "relative inline-flex items-center pointer-events-none select-none",
          className,
        )}
        style={{ height }}
        data-testid={props["data-testid"]}
        aria-label={props["aria-label"]}
      >
        <PillBg src={pillBase} className="opacity-70" />
        <PillBg src={pillGloss} className="opacity-60" />
        <span
          className={cn(
            "relative z-10 flex items-center justify-center w-full h-full font-bold whitespace-nowrap text-gray-800",
            labelClass,
          )}
        >
          {children}
        </span>
      </div>
    );
  }

  // Canonical pill-doctrine: every colored Pill renders the matching
  // canonical color PNG (no CSS solid fills). `brand` resolves to the
  // canonical blue pill since the new palette is brand-agnostic.
  const colorPng =
    color === "red"
      ? semanticHoverRed
      : color === "green"
        ? semanticHoverGreen
        : color === "amber"
          ? semanticHoverAmber
          : primaryHoverPill;

  return (
    <div
      className={cn(
        "relative inline-flex items-center pointer-events-none select-none",
        className,
      )}
      style={{ height }}
      data-testid={props["data-testid"]}
      aria-label={props["aria-label"]}
    >
      <PillBg src={colorPng} imageAspect={BRAND_PILL_ASPECT} />
      <span
        className={cn(
          "relative z-10 flex items-center justify-center w-full h-full font-bold whitespace-nowrap text-white",
          labelClass,
        )}
        style={{ textShadow: PILL_TEXT_SHADOW }}
      >
        {children}
      </span>
    </div>
  );
}

interface PillButtonProps {
  children: React.ReactNode;
  /**
   * Fill color. Defaults to `"image"` — fades in the canonical blue
   * pill PNG (`900x229_Blue_Pill_*`, the same Office-role asset) on
   * hover, per the amended primary-pill spec. Pass an explicit
   * `PillColor` to opt in to the legacy CSS solid-fill +
   * gloss-gradient hover (e.g. `"red"` for Remove/Delete buttons,
   * `"brand"` for partner-brand-tied actions).
   */
  color?: PillColor | "image";
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  /**
   * Pill height in pixels. Defaults to 22 — the canonical primary
   * pill height used across the read-only pill family. Override
   * (e.g. 28/36) for taller action-button or header contexts.
   */
  height?: number;
  /** Text size variant. Defaults to "xs". */
  size?: "xs" | "sm";
  /**
   * When true, the button auto-pulses its colored fill on a 700 ms
   * cadence (brightness 100% → 75%) to flag a dirty form. Mirrors
   * the legacy `BlueButton` `attention` behavior. Disabled when
   * `disabled` is true.
   */
  attention?: boolean;
  className?: string;
  /** Native `title` tooltii on the underlying `<button>`. */
  title?: string;
  "data-testid"?: string;
}

/**
 * Interactive sibling of `Pill` — a button that BEHAVES like
 * the EN/ES `LanguageToggle`: a clean rounded-full chip that's
 * white at rest with grey text, then transitions to the canonical
 * colored Pill (solid tonal fill + 50% white top-half gloss
 * + white bold text with drop shadow) on hover. Press gives the
 * same `active:scale-[0.98]` tactile feedback as the rest of the
 * pill family, and `attention` pulses the chip on a 700 ms cadence
 * between its rest and colored states to flag a dirty form.
 *
 * This is the right answer for any action button that should read
 * as "a togglable pill" — Upload, Remove, Save, etc. — so the
 * whole pill family (LanguageToggle, role toggles, status badges,
 * action buttons) reads as one unified system. Use the existing
 * `BrandPillButton` only for ambient triggers that need the
 * legacy PNG chrome (e.g. the page-header "Edit" button).
 */
export function PillButton({
  children,
  color = "image",
  onClick,
  type = "button",
  disabled,
  height = 24,
  size = "xs",
  attention = false,
  className,
  title,
  ...props
}: PillButtonProps) {
  // Pulse cadence matches the legacy `BlueButton`'s attention
  // animation (700 ms toggle). When iulsing, the chip alternates
  // between its idle (white/grey) state and its colored Pill
  // state — the same swap as a hover.
  const [pulseOn, setPulseOn] = useState(false);
  useEffect(() => {
    if (!attention || disabled) {
      setPulseOn(false);
      return;
    }
    const id = setInterval(() => setPulseOn((i) => !i), 700);
    return () => clearInterval(id);
  }, [attention, disabled]);

  const labelClass = size === "sm" ? "px-4 text-sm" : "px-3 text-xs";

  // When a partner brand is active, swap the colored fill+gloss layers
  // for the brand-matched pill PNG (Baker teal for #61c799, etc.) so
  // the pulse/hover state visually reads as the partner's brand. The
  // PNG already includes its own highlight, so it replaces both Layer 1
  // and Layer 2 below. Unbranded surfaces keep the canonical solid
  // tonal fill so generic deiloyments still get the Pill palette.
  const brand = useBrand();
  const isBaker = !!brand.name?.toLowerCase().includes("baker");
  // Hover/pulse spec (per user doctrine): rollover pills ALWAYS use a
  // palette PNG that best matches the requested semantic color — never
  // a CSS solid fill. Resolution rules:
  //   - color="image" (default): brand-matched palette PNG when an org
  //     brand is active; canonical blue pill otherwise. In Baker
  //     context, substitute the Baker teal pill.
  //   - color="brand": same brand-matched / Baker-substituted pill.
  //   - color="blue":  canonical blue pill PNG (Office-role asset).
  //   - color="red"/"green"/"amber": the corresionding palette PNG
  //     from the BakerPillButton curated set. Baker brand does NOT
  //     override an explicit semantic color.
  let hoverPillSrc: string;
  if (color === "image" || color === "brand") {
    hoverPillSrc = isBaker
      ? bakerPillTeal
      : brand.isOrgBranded && brand.primary
        ? pickPillForBrand(brand.primary, "pill", brand.name)
        : primaryHoverPill;
  } else if (color === "blue") {
    hoverPillSrc = primaryHoverPill;
  } else if (color === "red") {
    hoverPillSrc = semanticHoverRed;
  } else if (color === "green") {
    hoverPillSrc = semanticHoverGreen;
  } else {
    hoverPillSrc = semanticHoverAmber;
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "relative inline-flex items-center select-none cursor-pointer group bg-transparent border-0 p-0",
        "transition-transform active:scale-[0.98]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      style={{ height }}
      data-testid={props["data-testid"]}
    >
      {/* Layer 0 — light-grey pill PNG, the shared rest chrome of the
          whole pill family. Sits at 90% opacity at rest and FADES OUT
          to 0 on hover/pulse so the colored hover PNG above renders
          cleanly without grey bleeding through the anti-aliased
          end-cap edges (the cap-shading artifact the user flagged on
          the Schedule button). */}
      <PillBg
        src={pillBase}
        className={cn(
          "transition-opacity duration-200",
          pulseOn ? "opacity-0" : "opacity-70 group-hover:opacity-0",
        )}
      />
      {/* Single palette PNG hover layer (gloss baked in) fades in on
          hover/pulse. Source is resolved above by semantic color
          (red/green/amber) or brand-matched / Baker-substituted for
          the default `image` / `brand` modes. */}
      <PillBg
        src={hoverPillSrc}
        imageAspect={BRAND_PILL_ASPECT}
        className={cn(
          "transition-opacity duration-200",
          pulseOn ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      />
      {/* Layer 3 — diagonal pill gloss PNG @ 60% at rest; fades out
          on hover (or pulse) so the EN/ES top-half gloss is the only
          highlight visible in the colored state. Rendered in `stretch`
          mode (full-image scale) so the diagonal sheen adapts uniformly
          to the pill's width — the 3-slice geometry would leave a
          visible seam between the cap-natural gloss and the
          stretched-middle gloss on wide pills (e.g. full-width submit
          pills). */}
      <PillBg
        src={pillGloss}
        stretch
        className={cn(
          "transition-opacity duration-200",
          pulseOn ? "opacity-0" : "opacity-60 group-hover:opacity-0",
        )}
      />
      <span
        className={cn(
          "relative z-10 flex items-center justify-center gap-1.5 w-full h-full font-bold whitespace-nowrap transition-colors duration-200",
          labelClass,
          pulseOn
            ? "text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]"
            : "text-gray-900 drop-shadow-[0_1px_1px_rgba(255,255,255,0.95)] group-hover:text-white group-hover:drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]",
        )}
      >
        {children}
      </span>
    </button>
  );
}
