import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import WorkdayStatusSwitch from "@/components/workday-status-switch";
import "@/components/workday-controls.css";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function LanguageToggle({ className }: { className?: string }) {
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
  return <LanguageSlider current={current} onChange={set} className={className} />;
}

export function LanguageSlider({ current, onChange, className }: {
  current: "en" | "es";
  onChange: (language: "en" | "es") => void;
  className?: string;
}) {
  return (
    <div className={cn("language-status-slider inline-flex items-center gap-2 text-sm font-bold", className)} data-testid="language-toggle">
      <button type="button" onClick={() => onChange("en")} data-testid="lang-en" aria-pressed={current === "en"} className={cn("min-h-11 rounded px-1 font-bold focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)]", current === "en" ? "text-[var(--brand-primary)]" : "text-muted-foreground")}>English</button>
      <WorkdayStatusSwitch active={current === "es"} label="" accessibilityLabel="English / Español" onClick={() => onChange(current === "en" ? "es" : "en")} />
      <button type="button" onClick={() => onChange("es")} data-testid="lang-es" aria-pressed={current === "es"} className={cn("min-h-11 rounded px-1 font-bold focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)]", current === "es" ? "text-[var(--brand-primary)]" : "text-muted-foreground")}>Español</button>
    </div>
  );
}
