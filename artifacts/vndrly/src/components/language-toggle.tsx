import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useBrand } from "@/hooks/use-brand";
import { pickTogglePillSrc, TOGGLE_IDLE_PILL_SRC } from "@/lib/pick-toggle-pill";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function LanguageToggle({ className, variant = "dark" }: { className?: string; variant?: "dark" | "light" }) {
  const { t, i18n } = useTranslation();
  const { user, setPreferredLanguage } = useAuth();
  const { toast } = useToast();
  const current = i18n.language?.startsWith("es") ? "es" : "en";
  const set = (lng: "en" | "es") => {
    if (lng === current) return;
    void i18n.changeLanguage(lng);
    if (!user) return;
    // Optimistically update the cached user so the rest of the UI
    // immediately reflects the new preference; the network call below
    // is what actually persists it (and what the toast confirms).
    setPreferredLanguage(lng);
    // Resolve the localized language name *after* i18n.changeLanguage so
    // the confirmation reads in the language the user just switched to
    // ("Saved — Español" when switching to ES, "Saved — English" when
    // switching to EN). t() is bound to the live i18n instance and will
    // pick up the change synchronously since the resource is preloaded.
    const languageName = t(
      lng === "es" ? "languageToggle.spanish" : "languageToggle.english",
    );
    void (async () => {
      try {
        const res = await fetch(`${BASE}/api/auth/me/language`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: lng }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast({
          title: t("languageToggle.savedToast", { language: languageName }),
        });
      } catch {
        toast({
          variant: "destructive",
          title: t("languageToggle.saveFailedToast"),
        });
      }
    })();
  };
  const isDark = variant === "dark";
  const brand = useBrand();
  // Active half = clipped half of the canonical pill PNG that best
  // matches the active brand color (amber / blue / green / red, with a
  // grey neutral fallback). One image scaled to 200% width, anchored
  // `left center` for the left button (EN) or `right center` for the
  // right button (ES) — the toggle still reads as a single pill
  // silhouette across both halves rather than two pill PNGs sitting
  // side-by-side. The "except baker" rule from the user spec is
  // enforced by `pickTogglePillSrc` (baker assets are excluded from
  // its palette). See dark-light-toggle.tsx for the same treatment.
  const activePillSrc = pickTogglePillSrc(brand.primary);
  const activeBgStyle = (side: "left" | "right") =>
    ({
      backgroundImage: `url(${activePillSrc})`,
      backgroundSize: "200% 100%",
      backgroundPosition: side === "left" ? "left center" : "right center",
      backgroundRepeat: "no-repeat",
      textShadow: "0 1px 2px rgba(0,0,0,0.65), 0 2px 4px rgba(0,0,0,0.45)",
    }) as const;
  // Inactive half = clipped half of the canonical light-grey pill PNG
  // (the new-palette asset that best matches the previous solid-white
  // chip). Same 200% width + left|right anchor trick as the active
  // half, so the two halves still read as one continuous pill
  // silhouette across the toggle.
  const idleBgStyle = (side: "left" | "right") =>
    ({
      backgroundImage: `url(${TOGGLE_IDLE_PILL_SRC})`,
      backgroundSize: "200% 100%",
      backgroundPosition: side === "left" ? "left center" : "right center",
      backgroundRepeat: "no-repeat",
    }) as const;
  const base = "px-2 py-0.5 text-xs font-bold transition-colors cursor-pointer select-none";
  const activeCls = "text-white";
  // Idle text. The previous `bg-white` on the light variant has been
  // dropped — the inactive half now paints a clipped half of the
  // canonical light-grey pill PNG via `idleBgStyle`, so the solid
  // white background would double-up and re-introduce a hard rectangle
  // behind the pill silhouette.
  const idleCls = isDark
    ? "text-sidebar-foreground/80 hover:text-gray-900"
    : "text-gray-600 hover:text-gray-900";
  // Divider color between EN and ES halves. Replaces the previous
  // outer wrapper border (which read as a faint outline around the
  // whole toggle) with a single vertical hairline that visually splits
  // the two halves regardless of which side is active.
  const dividerCls = "bg-gray-400";
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full overflow-hidden",
        className,
      )}
      data-testid="language-toggle"
    >
      <button
        type="button"
        onClick={() => set("en")}
        className={cn(base, current === "en" ? activeCls : idleCls)}
        style={current === "en" ? activeBgStyle("left") : idleBgStyle("left")}
        data-testid="lang-en"
        aria-pressed={current === "en"}
      >
        EN
      </button>
      {/* Vertical hairline divider between EN and ES so the two halves
          read as a clearly split toggle rather than one continuous
          chip. Color follows the variant (lighter on dark surfaces,
          darker on light surfaces). */}
      <span
        aria-hidden
        className={cn("self-stretch w-px my-px", dividerCls)}
      />
      <button
        type="button"
        onClick={() => set("es")}
        className={cn(base, current === "es" ? activeCls : idleCls)}
        style={current === "es" ? activeBgStyle("right") : idleBgStyle("right")}
        data-testid="lang-es"
        aria-pressed={current === "es"}
      >
        ES
      </button>
    </div>
  );
}
