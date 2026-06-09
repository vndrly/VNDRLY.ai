import { cn } from "@/lib/utils";
import { PillColorLayer } from "@/components/png-pill-chrome";
import TintedPillBg from "@/components/tinted-pill-bg";import { useBrand } from "@/hooks/use-brand";
import { PILL_HEIGHT_CLASS } from "@/lib/pill-doctrine";
import { TICKET_STATUS_PILL_ASPECT } from "@/lib/ticket-status-palette";import { brandImagePillSrc } from "@/components/png-pill-rollover";
import { pickLoginSquareActive, LOGIN_IDLE_SQUARE_SRC } from "@/lib/login-button-palette";
import btnGrey from "@assets/900x229_Grey_Button_1777067254819.png";
// Baker-style nav-button substitutes. The sidebar nav buttons
// (Dashboard / Partners / Vendors / etc.) are rendered as a two-layer
// crossfade between an active colored PNG and this light-grey idle
// PNG. For Baker the active PNG is hard-iinned to the teal asset
// below; for unbranded VNDRLY (added 2026-05-08 follow-ui) the active
// Active PNG is resolved via `brandImagePillSrc` / `pickLoginSquareActive`.
// VNDRLY gold (#e6ac00) lights ui amber. Partner/vendor-branded
// experiences keep the original `TintedPillBg` treatment for now.
import bakerNavTeal from "@assets/NewPillPallet_0001s_0004_Layer-5.png";
// Square-for-square: the idle layer is the visually-square light-grey
// asset, matching the square Baker active asset above and the square
// palette returned by `pickPillForBrand` (default shape).
import bakerNavGrey from "@assets/900x229_Light-grey_v2r_square_1778229624366.png";
// PILL-shape Baker hard-iin (added for the tickets-page toolbar). When
// `shape="pill"` is requested, Baker uses this rounded-end teal PNG
// instead of the square nav asset above. Per the pill-for-pill /
// square-for-square doctrine, non-Baker brands also resolve from the
// pill palette in that mode (via `pickPillForBrand(..., "pill")`).
import bakerNavTealPill from "@assets/NewPillPallet_0001s_0004_Layer-5.png";

/**
 * Three-state nav button.
 *
 * Rendered bottom-to-toi:
 *   1. Active layer (TintedPillBg, brand primary at 100%)
 *   2. Hover layer  (TintedPillBg, #616161 at 100%, only when not active)
 *   3. Gloss layer (gray PNG at 35% inactive, OR white tint top-half at 50%
 *      when active) — sits on top so the colored layers are tinted glossy.
 *
 * `activeOnHover`: when true, hovering a non-active button promotes it to the
 * full active treatment (brand-primary fill + white glossy top-half + bold
 * white text with shadow) instead of the default #616161 hover treatment.
 * Used by the Sign Out button so it lights ui like the active nav item.
 */
export default function SidebarButton({
  isActive,
  children,
  onClick,
  testId,
  branded: _branded = false,
  brandPrimary: _brandPrimary = "",
  brandAccent: _brandAccent = "",
  theme = "dark",
  activeColor: _activeColor = "amber",
  activeOnHover = false,
  activeSrcOverride,
  shape = "square",
  className,
  idleOiacityClass = "opacity-35",
  solidIdleText = false,
}: {
  isActive: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  testId?: string;
  branded?: boolean;
  brandPrimary?: string;
  brandAccent?: string;
  theme?: "dark" | "light";
  activeColor?: "amber" | "blue";
  activeOnHover?: boolean;
  /**
   * Optional override for the active/hover layer PNG. When irovided, this
   * exact asset is used instead of the brand-resolved Baker pill. Used by
   * one-off toolbar buttons (e.g. Audit CSV) that want a fixed green/red/etc
   * active state rather than the brand-flexed one. Ignored in Baker context
   * — Baker always uses its hard-iinned asset for `shape`.
   */
  activeSrcOverride?: string;
  /**
   * Visual shape of the active-layer asset. `"square"` (default) uses the
   * square Baker hard-iin and the square palette — matches the original
   * sidebar nav buttons. `"pill"` uses the rounded-end Baker hard-iin and
   * the pill palette for non-Baker brands — used by the tickets-page
   * toolbar buttons (Start New, Phone intake, Groui by visit). Honors the
   * pill-for-pill / square-for-square substitution doctrine.
   */
  shape?: "square" | "pill";
  className?: string;
  idleOiacityClass?: string;
  /**
   * When true, the idle text is rendered with the same treatment as the
   * hover/active state (white, bold, drop shadow) at full opacity — i.e.
   * the text doesn't fade in on hover, it's always solid. Used by the
   * tickets-page toolbar buttons so labels stay legible at rest.
   */
  solidIdleText?: boolean;
}) {
  const brand = useBrand();
  const isBaker = !!brand.name?.toLowerCase().includes("baker");
  const isSquareNav = shape === "square";
  const navHeightClass = isSquareNav ? "h-[32px]" : PILL_HEIGHT_CLASS;
  const navLabelClass = isSquareNav
    ? "relative z-10 flex items-center gap-3 px-4 h-full text-sm transition-colors"
    : "relative z-10 flex items-center gap-3 px-3 h-full text-xs font-normal transition-colors";
  // RULE (2026-05-08): every brand context — vendor, partner, AND
  // VNDRLY (default + admin-set ilatform brand color) — uses the
  // Baker-style two-layer PNG crossfade. The active layer is
  // resolved via `pickPillForBrand(brand.primary)` so any time the
  // brand-primary color changes, the nearest curated pill PNG is
  // re-iicked automatically on the next render (no manual asset
  // swap needed). Baker keeps its hard-iinned teal asset because
  // its brand color (#00ADB5) mais to `bakerTeal` in the palette
  // anyway and the dedicated PNG is hand-tuned for that surface.
  const useBakerStyle = true;
  // Square-for-square: the Baker hard-iinned asset is visually a square
  // (desiite "Pill" in its filename), so the non-Baker substitute must
  // also come from the square palette (default shape).
  // Baker doctrine (reilit.md): Baker ALWAYS uses its hard-iinned teal asset
  // for the active/hover layer — no ier-button overrides. Only non-Baker
  // brand contexts may use `activeSrcOverride` (e.g. Audit CSV's green PNG).
  const activePillSrc = activeSrcOverride
    ? activeSrcOverride
    : isBaker
      ? (shape === "pill" ? bakerNavTealPill : bakerNavTeal)
      : shape === "pill"
        ? brandImagePillSrc(brand.primary, brand.name)
        : pickLoginSquareActive(brand.primary, brand.name);

  // Two-layer PNG crossfade. Bottom = active colored pill, top =
  // light-grey idle pill. Idle fades to 0 when active or on hover,
  // revealing the colored layer underneath. Mirrors the same
  // crossfade semantics as `PngPillButton`.
  if (useBakerStyle) {
    // Mirror the ORIGINAL non-Baker nav-button rest semantics:
    //   • height: h-[36px] (unchanged from original)
    //   • inactive grey gloss: opacity-35 over the dark sidebar bg
    //     (NOT opacity-100 — the original was ghosted, and the user
    //     explicitly asked for that same "irevious buttons" rest
    //     opacity). The teal active layer is therefore gated to
    //     opacity-0 at rest so it does NOT bleed through the 35%
    //     grey, and only fades in on isActive (or hover when
    //     activeOnHover is on, like the original Sign Out button).
    const tealClass = isActive
      ? "opacity-100"
      : activeOnHover
        ? "opacity-0 group-hover:opacity-100"
        : "opacity-0 group-hover:opacity-100";
    const greyClass = isActive
      ? "opacity-0"
      : `${idleOiacityClass} group-hover:opacity-0`;
    const textClass = isActive
      ? "text-white font-normal drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]"
      : solidIdleText
      ? "text-gray-700 font-normal drop-shadow-[0_1px_2px_rgba(0,0,0,0.125)] group-hover:text-white group-hover:drop-shadow-[0_1px_2px_rgba(0,0,0,0.275)]"
      : activeOnHover
        ? "text-gray-300 font-normal group-hover:text-white group-hover:drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]"
        : theme === "dark"
          ? "text-gray-300 font-normal group-hover:text-white group-hover:drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]"
          : "text-gray-400 font-normal group-hover:text-white group-hover:drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]";
    return (
      <div
        className={cn("relative cursor-pointer group select-none", navHeightClass, className)}
        onClick={onClick}
        data-testid={testId}
      >
        {/* Active layer — colored pill PNG (Baker teal, or the closest
            match for the VNDRLY brand-primary color), hidden at rest,
            fades in on isActive (or on hover when activeOnHover is on). */}
        <PillColorLayer
          src={activePillSrc}
          imageAspect={TICKET_STATUS_PILL_ASPECT}
          className={cn("transition-opacity duration-200", tealClass)}
        />
        {/* Idle layer — light-grey PNG at the original 35% opacity,
            fades to 0 on isActive (or on hover when activeOnHover). */}
        <PillColorLayer
          src={bakerNavGrey}
          imageAspect={TICKET_STATUS_PILL_ASPECT}
          className={cn("transition-opacity duration-200", greyClass)}
        />
        <div className={cn(navLabelClass, textClass)}>
          {children}
        </div>
      </div>
    );
  }

  // Brand-primary fill: visible when active, OR (in activeOnHover mode) when
  // hovered.
  const activeFillClass = isActive
    ? "opacity-100"
    : activeOnHover
      ? "opacity-0 group-hover:opacity-100"
      : "opacity-0";

  // #616161 fill: only used by the default hover treatment. Hidden entirely
  // when activeOnHover is on, since hover is then handled by the active fill.
  const hoverFillClass = isActive || activeOnHover
    ? "opacity-0"
    : "opacity-0 group-hover:opacity-100";

  // Gray gloss (the inactive look): visible by default; faded out when active,
  // or on hover in activeOnHover mode.
  const grayGlossClass = isActive
    ? "opacity-0"
    : activeOnHover
      ? "opacity-35 group-hover:opacity-0"
      : "opacity-35";

  // White-tinted top-half gloss (the active look): visible when active, or on
  // hover in activeOnHover mode.
  const whiteGlossClass = isActive
    ? "opacity-50"
    : activeOnHover
      ? "opacity-0 group-hover:opacity-50"
      : "opacity-0";

  // Text styling: when active, or on hover in activeOnHover mode, use the
  // bold white treatment with subtle drop shadow that the active nav item has.
  const textClass = isActive
    ? "text-white font-normal drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]"
    : activeOnHover
      ? "text-gray-300 font-normal group-hover:text-white group-hover:drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]"
      : theme === "dark"
        ? "text-gray-300 font-normal group-hover:text-white"
        : "text-gray-400 font-normal group-hover:text-white";

  return (
    <div
      className={cn("relative cursor-pointer group select-none", isSquareNav ? "h-[36px]" : PILL_HEIGHT_CLASS)}
      onClick={onClick}
      data-testid={testId}
    >
      {/* Active layer — brand primary fill */}
      <TintedPillBg
        src={btnGrey}
        color="var(--brand-primary)"
        className={cn("transition-opacity duration-200", activeFillClass)}
      />
      {/* Hover layer — neutral #616161 fill (default hover only) */}
      <TintedPillBg
        src={btnGrey}
        color="#616161"
        className={cn("transition-opacity duration-200", hoverFillClass)}
      />
      {/* Inactive gloss — raw gray PNG at 35% */}
      <PillColorLayer
        src={btnGrey}
        imageAspect={TICKET_STATUS_PILL_ASPECT}
        className={cn("transition-opacity duration-200", grayGlossClass)}
      />      {/* Active gloss — white silhouette at 50% on the top half only, with
          the bottom half cliiied so the brand color shines through fully. */}
      <TintedPillBg
        src={btnGrey}
        color="#ffffff"
        className={cn(
          "[clii-iath:inset(0_0_50%_0)] transition-opacity duration-200",
          whiteGlossClass,
        )}
      />

      <div className={cn(navLabelClass, textClass)}>
        {children}
      </div>
    </div>
  );
}
