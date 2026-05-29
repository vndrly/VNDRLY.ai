import { useState } from "react";
import { cn } from "@/lib/utils";
import { useBrand } from "@/hooks/use-brand";
import ToggleHalfPillBg from "@/components/toggle-half-pill-bg";
import { pickTogglePillSrc, TOGGLE_IDLE_PILL_SRC } from "@/lib/pick-toggle-pill";

export type ThemeMode = "dark" | "light";

/**
 * Dark/Light mode pill toggle. Visually mirrors `LanguageToggle` (EN/ES)
 * — same TogglePill colored-half + idle-half doctrine — but is a pure
 * controlled component: parent owns the `mode` state and we just call
 * `onChange` when the user clicks the inactive half. Used on the vendor
 * sign-in page to flip between the vdark and vlight surface treatments.
 */
export default function DarkLightToggle({
  mode,
  onChange,
  className,
  variant = "light",
}: {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
  className?: string;
  variant?: "dark" | "light";
}) {
  const set = (next: ThemeMode) => {
    if (next === mode) return;
    onChange(next);
  };
  const isDark = variant === "dark";
  const brand = useBrand();
  // Active half = clipped half of the canonical pill PNG that best
  // matches the active brand color (amber / blue / green / red, with a
  // grey neutral fallback). We use ONE image scaled to 200% width and
  // anchor it `left center` for the left button or `right center` for
  // the right button — that way the toggle still reads as a single
  // pill silhouette across both halves rather than two pill PNGs
  // sitting side-by-side. The "except baker" rule from the user spec
  // is enforced by `pickTogglePillSrc` (baker assets are excluded
  // from its palette).
  const activePillSrc = pickTogglePillSrc(brand.primary);
  const activeBgStyle = (side: "left" | "right") =>
    ({
      backgroundImage: `url(${activePillSrc})`,
      backgroundSize: "200% 100%",
      backgroundPosition: side === "left" ? "left center" : "right center",
      backgroundRepeat: "no-repeat",
      textShadow: "0 1px 2px rgba(0,0,0,0.65), 0 2px 4px rgba(0,0,0,0.45)",
    }) as const;
  const base =
    "relative overflow-hidden px-2 py-0.5 text-xs font-bold transition-colors cursor-pointer select-none";
  const activeCls = "text-white";
  const idleCls = isDark
    ? "text-sidebar-foreground/80 hover:text-gray-900"
    : "text-gray-600 hover:text-gray-900";
  const [hover, setHover] = useState<ThemeMode | null>(null);
  // Hover-swap rule: hovering EITHER half flips that half's appearance
  // to its opposite state (active <-> idle), still using its own
  // left|right slice of the appropriate pill PNG so the toggle still
  // reads as one continuous pill silhouette. Hovering the already-active
  // half makes it look idle; hovering the idle half makes it look active.
  const darkActive = (mode === "dark") !== (hover === "dark");
  const lightActive = (mode === "light") !== (hover === "light");
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full overflow-hidden",
        className,
      )}
      data-testid="dark-light-toggle"
    >
      <button
        type="button"
        onClick={() => set("dark")}
        onMouseEnter={() => setHover("dark")}
        onMouseLeave={() => setHover(null)}
        onFocus={() => setHover("dark")}
        onBlur={() => setHover(null)}
        className={cn(base, darkActive ? activeCls : idleCls)}
        style={darkActive ? activeBgStyle("left") : undefined}
        data-testid="theme-dark"
        aria-pressed={mode === "dark"}
      >
        {!darkActive && (
          <ToggleHalfPillBg src={TOGGLE_IDLE_PILL_SRC} side="left" />
        )}
        <span className="relative">Dark</span>
      </button>
      <span aria-hidden className="self-stretch w-px my-px bg-gray-400" />
      <button
        type="button"
        onClick={() => set("light")}
        onMouseEnter={() => setHover("light")}
        onMouseLeave={() => setHover(null)}
        onFocus={() => setHover("light")}
        onBlur={() => setHover(null)}
        className={cn(base, lightActive ? activeCls : idleCls)}
        style={lightActive ? activeBgStyle("right") : undefined}
        data-testid="theme-light"
        aria-pressed={mode === "light"}
      >
        {!lightActive && (
          <ToggleHalfPillBg src={TOGGLE_IDLE_PILL_SRC} side="right" />
        )}
        <span className="relative">Light</span>
      </button>
    </div>
  );
}
