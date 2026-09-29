import { type ReactNode } from "react";
import LanguageToggle from "@/components/language-toggle";
import { NavPaneHalftoneBackground } from "@/components/nav-pane-halftone-background";
import { NAV_PANE_DARK_BG } from "@/components/nav-pane-tokens";
import { brandStyleVars, type Brand } from "@/hooks/use-brand";

interface OnboardingPageShellProps {
  brand: Brand;
  children: ReactNode;
}

/**
 * Shared VNDRLY visual shell for the partner and vendor onboarding wizards.
 * Keeps the public onboarding experience aligned with login, signup, and the
 * portal: steel/halftone navigation chrome, oilfield imagery, brand accent,
 * and the canonical language control.
 */
export function OnboardingPageShell({
  brand,
  children,
}: OnboardingPageShellProps): React.ReactElement {


  return (
    <div
      className="min-h-screen relative overflow-x-hidden px-4 py-8 sm:px-6 sm:py-10"
      style={{
        ...brandStyleVars(brand),
        backgroundColor: NAV_PANE_DARK_BG,
      }}
      data-testid="onboarding-page-shell"
      data-theme="dark"
    >
      <img
        src="/vndrly-background.jpg"
        alt=""
        aria-hidden="true"
        className="fixed inset-0 h-full w-full object-cover pointer-events-none transition-opacity duration-300"
        style={{ opacity: 0.24 }}
        draggable={false}
      />
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: "linear-gradient(135deg, rgba(34,37,42,0.96) 0%, rgba(58,61,66,0.86) 52%, rgba(17,24,39,0.78) 100%)",
        }}
      />
      <NavPaneHalftoneBackground enabled variant="auth" />
      <div className="fixed inset-x-0 top-0 h-28 bg-gradient-to-b from-black/20 to-transparent pointer-events-none" />
      <div className="fixed inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/25 to-transparent pointer-events-none" />
      <div
        className="fixed inset-x-0 top-0 h-1 pointer-events-none"
        style={{ backgroundColor: "var(--brand-primary)" }}
      />


      <div className="fixed top-4 right-4 z-30">
        <LanguageToggle variant="dark" />
      </div>

      <main className="relative z-10 mx-auto w-full max-w-4xl pt-10">
        {children}
      </main>
    </div>
  );
}
