import { navigateBackInApp } from "@/lib/in-app-navigation";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import SphereBackButton from "@/components/sphere-back-button";
import { VNDRLY_LOGO_SQUARE as vndrlyLogo } from "@/lib/vndrly-brand-assets";
import LanguageToggle from "@/components/language-toggle";
import { cn } from "@/lib/utils";
import { NAV_PANE_DARK_BG } from "@/components/nav-pane-tokens";
import { NavPaneHalftoneBackground } from "@/components/nav-pane-halftone-background";
export default function AccessibilityPage() {
  const [, navigate] = useLocation();
  const { i18n } = useTranslation();
  const spanish = i18n.language.startsWith("es");
  const prefix = spanish ? "/es" : "";
  const title = spanish ? "Accesibilidad" : "Accessibility";
  const statement = spanish
    ? "VNDRLY.ai no ofrece actualmente opciones de accesibilidad dedicadas ni ajustes específicos de accesibilidad en sus experiencias web e iOS. Publicamos esta información para que los usuarios puedan evaluar las capacidades actuales de la plataforma antes de utilizarla.\n\nNo hemos completado una validación integral de la plataforma con tecnologías de asistencia y no declaramos conformidad con un estándar de accesibilidad específico. El funcionamiento de las opciones de accesibilidad del navegador o del dispositivo puede variar según el entorno y la función utilizada; no garantizamos su compatibilidad en toda la plataforma.\n\nSi una barrera de acceso le impide utilizar VNDRLY.ai, puede comunicarse con support@vndrly.ai e indicar la página o función afectada, su dispositivo y las herramientas de asistencia que utiliza. Sus comentarios nos ayudan a comprender las necesidades de los usuarios; no implican que una adaptación o actualización específica esté disponible ni que tenga una fecha de entrega confirmada."
    : "VNDRLY.ai does not currently offer dedicated accessibility options or accessibility-specific settings across its web and iOS experiences. We provide this information so users can evaluate the platform’s current capabilities before relying on it.\n\nWe have not completed comprehensive validation of the platform with assistive technologies and do not currently claim conformance to a specific accessibility standard. Browser and device accessibility settings may behave differently depending on the environment and feature in use; compatibility across the platform is not guaranteed.\n\nIf an access barrier prevents you from using VNDRLY.ai, please contact support@vndrly.ai with the affected page or feature, your device, and any assistive tools you use. Feedback helps us understand user needs; it does not mean that a particular accommodation or update is available or has a confirmed delivery date.";
  const backLabel = spanish ? "Volver al inicio de sesión" : "Back to sign in";
  const legalLinks = <nav className="mb-5 flex flex-wrap gap-x-3 gap-y-2 text-sm text-amber-400" aria-label={spanish ? "Documentos legales" : "Legal documents"}>
    <a className="underline underline-offset-2" href="/legal/eula">EULA</a>
    <a className="underline underline-offset-2" href={`${prefix}/sms/`}>{spanish ? "Inscripción a SMS" : "SMS Enrollment"}</a>
    <a className="underline underline-offset-2" href={`${prefix}/legal/privacy/`}>{spanish ? "Política de privacidad" : "Privacy Policy"}</a>
    <a className="underline underline-offset-2" href={`${prefix}/legal/terms/`}>{spanish ? "Términos y condiciones" : "Terms & Conditions"}</a>
  </nav>;


  return (
    <div
      className="min-h-screen flex flex-col px-6 py-12 lg:px-16 relative overflow-hidden"
      style={{ backgroundColor: NAV_PANE_DARK_BG, "--brand-primary": "#F59E0B", "--brand-icon-color": "#242426" } as React.CSSProperties}
    >
      <NavPaneHalftoneBackground enabled variant="auth" />
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2">

        <LanguageToggle />
      </div>
      <div className="w-full max-w-3xl mx-auto relative z-10">
        <button type="button" className="group mb-6 inline-flex items-center gap-2 text-sm font-semibold text-amber-400 hover:text-amber-300" onClick={() => navigateBackInApp(navigate, "/login")}>
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
              {title}
            </h1>
            <p
              className={cn(
                "text-sm mt-1",
                "text-gray-300",
              )}
            >
              {spanish ? "Última actualización" : "Last updated"} {"2026-11-12"}
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
            data-testid="text-accessibility-body"
          >
            {statement}
          </pre>
        </div>

        <div className={cn("mt-8 pt-4 border-t", "border-white/20")}>
          <button
            type="button"
            className={cn(
              "group inline-flex items-center gap-2 text-sm font-semibold",
              "text-amber-400 hover:text-amber-300",
            )}
            onClick={() => navigateBackInApp(navigate, "/login")}
            data-testid="link-accessibility-back-sign-in"
          >
            <SphereBackButton size={32} />{backLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
