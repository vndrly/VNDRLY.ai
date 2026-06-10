import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useBrand } from "@/hooks/use-brand";
import SplitToggleHalf from "@/components/split-toggle-half";
import {
  pickTogglePillSrc,
  splitToggleDividerClass,
  TOGGLE_IDLE_PILL_SRC,
  type SplitToggleVariant,
} from "@/lib/pick-toggle-pill";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function LanguageToggle({ className, variant = "dark" }: { className?: string; variant?: SplitToggleVariant }) {
  const { t, i18n } = useTranslation();
  const { user, setPreferredLanguage } = useAuth();
  const { toast } = useToast();
  const current = i18n.language?.startsWith("es") ? "es" : "en";
  const set = (lng: "en" | "es") => {
    if (lng === current) return;
    void i18n.changeLanguage(lng);
    if (!user) return;
    setPreferredLanguage(lng);
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
  const brand = useBrand();
  const activePillSrc = pickTogglePillSrc(brand.primary, brand.name);
  const dividerClass = splitToggleDividerClass(variant);

  return (
    <div
      className={cn(
        "inline-flex items-stretch rounded-full overflow-hidden",
        className,
      )}
      data-testid="language-toggle"
    >
      <SplitToggleHalf
        side="left"
        active={current === "en"}
        pillSrc={current === "en" ? activePillSrc : TOGGLE_IDLE_PILL_SRC}
        onClick={() => set("en")}
        data-testid="lang-en"
        aria-pressed={current === "en"}
      >
        EN
      </SplitToggleHalf>
      <span aria-hidden className={cn("w-px shrink-0 self-stretch", dividerClass)} />
      <SplitToggleHalf
        side="right"
        active={current === "es"}
        pillSrc={current === "es" ? activePillSrc : TOGGLE_IDLE_PILL_SRC}
        onClick={() => set("es")}
        data-testid="lang-es"
        aria-pressed={current === "es"}
      >
        ES
      </SplitToggleHalf>
    </div>
  );
}
