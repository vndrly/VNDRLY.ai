import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import SphereBackButton from "@/components/sphere-back-button";
import { VNDRLY_LOGO_SQUARE as vndrlyLogo } from "@/lib/vndrly-brand-assets";
import LanguageToggle from "@/components/language-toggle";
import { cn } from "@/lib/utils";
import { NAV_PANE_DARK_BG } from "@/components/nav-pane-tokens";
import { NavPaneHalftoneBackground } from "@/components/nav-pane-halftone-background";
import {
  PLATFORM_EULA_LAST_UPDATED,
  PLATFORM_EULA_TEXT,
  PLATFORM_EULA_TITLE,
} from "@workspace/platform-eula";

export default function PlatformEulaPage() {
  const [, navigate] = useLocation();
  const { i18n } = useTranslation();
  const spanish = i18n.language.startsWith("es");
  const prefix = spanish ? "/es" : "";
  const backLabel = spanish ? "Volver al inicio de sesión" : "Back to sign in";
  const legalLinks = <nav className="mb-5 flex flex-wrap gap-x-3 gap-y-2 text-sm text-amber-400" aria-label={spanish ? "Documentos legales" : "Legal documents"}>
    <a className="underline underline-offset-2" href={`${prefix}/sms/`}>{spanish ? "Inscripción a SMS" : "SMS Enrollment"}</a>
    <a className="underline underline-offset-2" href={`${prefix}/legal/privacy/`}>{spanish ? "Política de privacidad" : "Privacy Policy"}</a>
    <a className="underline underline-offset-2" href={`${prefix}/legal/terms/`}>{spanish ? "Términos y condiciones" : "Terms & Conditions"}</a>
  </nav>;


  return (
    <div
      className="min-h-screen flex flex-col px-6 py-12 lg:px-16 relative overflow-hidden"
      style={{ backgroundColor: NAV_PANE_DARK_BG, "--brand-primary": "#F59E0B" } as React.CSSProperties}
    >
      <NavPaneHalftoneBackground enabled variant="auth" />
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2">

        <LanguageToggle variant="dark" />
      </div>
      <div className="w-full max-w-3xl mx-auto relative z-10">
        <button type="button" className="group mb-6 inline-flex items-center gap-2 text-sm font-semibold text-amber-400 hover:text-amber-300" onClick={() => navigate("/login")}>
          <SphereBackButton size={32} />{backLabel}
        </button>
        <div className="flex items-center gap-3 mb-6">
          <img
            src={vndrlyLogo}
            alt="VNDRLY Logo"
            className="w-12 h-12 rounded-lg shrink-0"
            draggable={false}
          />
          <div>
            <h1
              className={cn(
                "text-2xl font-bold tracking-tight",
                "text-white",
              )}
            >
              {PLATFORM_EULA_TITLE}
            </h1>
            <p
              className={cn(
                "text-sm mt-1",
                "text-gray-300",
              )}
            >
              {spanish ? "Última actualización" : "Last updated"} {PLATFORM_EULA_LAST_UPDATED}
            </p>
          </div>
        </div>

        {legalLinks}
        <div
          className={cn(
            "rounded-xl border-2 p-6 shadow-sm",
            "border-amber-500 bg-white/5 text-gray-100",
          )}
        >
          <pre
            className="whitespace-pre-wrap text-sm leading-relaxed font-sans"
            data-testid="text-platform-eula-body"
          >
            {PLATFORM_EULA_TEXT}
          </pre>
        </div>

        <div className={cn("mt-8 pt-4 border-t", "border-white/20")}>
          <button
            type="button"
            className={cn(
              "group inline-flex items-center gap-2 text-sm font-semibold",
              "text-amber-400 hover:text-amber-300",
            )}
            onClick={() => navigate("/login")}
            data-testid="link-eula-back-sign-in"
          >
            <SphereBackButton size={32} />{backLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
