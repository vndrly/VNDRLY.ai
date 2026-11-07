import { navigateBackInApp } from "@/lib/in-app-navigation";
import { CardHeading } from "@/components/ui/card-heading";
import { useLocation } from "wouter";
import { VNDRLY_LOGO_SQUARE as vndrlyLogo } from "@/lib/vndrly-brand-assets";
import LanguageToggle from "@/components/language-toggle";
import SphereBackButton from "@/components/sphere-back-button";
import OnboardingPillButton from "@/components/onboarding-pill-button";
import "./vendor-profile.css";
import { brandStyleVars, DEFAULT_BRAND } from "@/hooks/use-brand";
import { NAV_PANE_DARK_BG } from "@/components/nav-pane-tokens";
import { NavPaneHalftoneBackground } from "@/components/nav-pane-halftone-background";
import { cn } from "@/lib/utils";

export default function Signup() {
  const [, navigate] = useLocation();


  return (
    <div
      className="min-h-screen flex flex-col text-white lg:flex-row [--app-card-heading-color:#fff]"
      data-theme="dark"
      style={brandStyleVars(DEFAULT_BRAND)}
    >
      <div
        className="flex-1 flex items-center justify-center px-6 py-12 lg:px-16 relative overflow-hidden"
        style={{ backgroundColor: NAV_PANE_DARK_BG }}
      >
        <NavPaneHalftoneBackground enabled variant="auth" />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/8 to-transparent pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/8 to-transparent pointer-events-none" />
        <div className="absolute top-4 right-4 z-20">
          <LanguageToggle />
        </div>

        <div className="w-full max-w-md relative z-10">
          <div className="flex items-center gap-3 mb-6">
            <img
              src={vndrlyLogo}
              alt="VNDRLY Logo"
              className="w-16 h-16 rounded-xl shrink-0"
              draggable={false}
            />
          </div>
          <div className="flex items-start gap-3 mb-10">
            <button
              type="button"
              onClick={() => navigateBackInApp(navigate, "/")}
              className="group inline-flex items-center shrink-0 mt-0.5"
              aria-label="Back"
              data-testid="button-back"
            >
              <SphereBackButton size={40} />
            </button>
            <div>
              <h1
                className={cn(
                  "text-3xl font-bold tracking-tight",
                  "text-white",
                )}
              >
                Get Started with VNDRLY
              </h1>
              <p
                className={cn(
                  "text-sm mt-2",
                  "text-gray-300",
                )}
              >
                Choose your account type to begin onboarding.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div data-card-layout
              className={cn(
                "border-2 rounded-xl p-6 transition-colors",
                "border-[color:var(--brand-primary)] bg-[#242426]",
              )}
            >
              <CardHeading as="h2"
                className={cn(
                  "text-lg font-bold mb-1",
                  "text-white",
                )}
              >
                Sign Up as a Vendor
              </CardHeading>
              <p
                className={cn(
                  "text-sm",
                  "text-gray-300",
                )}
              >
                You provide field services and assign employees to job sites.
              </p>
              <div className="mt-4">
                <OnboardingPillButton
                  className="w-full"
                  data-testid="button-begin-vendor-onboarding"
                  onClick={() => navigate("/signup/vendor")}
                >
                  Begin Vendor Onboarding
                </OnboardingPillButton>
              </div>
            </div>

            <div data-card-layout
              className={cn(
                "border-2 rounded-xl p-6 transition-colors",
                "border-[color:var(--brand-primary)] bg-[#242426]",
              )}
            >
              <CardHeading as="h2"
                className={cn(
                  "text-lg font-bold mb-1",
                  "text-white",
                )}
              >
                Sign Up as a Partner
              </CardHeading>
              <p
                className={cn(
                  "text-sm",
                  "text-gray-300",
                )}
              >
                You own or manage drilling sites and oversee vendor operations.
              </p>
              <div className="mt-4">
                <OnboardingPillButton
                  className="w-full"
                  data-testid="button-begin-partner-onboarding"
                  onClick={() => navigate("/signup/partner")}
                >
                  Begin Partner Onboarding
                </OnboardingPillButton>
              </div>
            </div>
          </div>

          <div
            className={cn(
              "mt-6 pt-4 border-t",
              "border-white/20",
            )}
          >
            <p
              className={cn(
                "text-sm text-center",
                "text-gray-300",
              )}
            >
              Already have an account?{" "}
              <a
                href="/"
                className="font-semibold text-[color:var(--brand-primary)] hover:underline underline-offset-2"
                onClick={(e) => {
                  e.preventDefault();
                  navigate("/");
                }}
              >
                Sign In
              </a>
            </p>
          </div>
        </div>
      </div>

      <div className="hidden lg:block w-[3px] bg-[color:var(--brand-primary)] shrink-0" />

      <div className="hidden lg:flex flex-1 relative overflow-hidden">
        <img
          src="/vndrly-background.jpg"
          alt="Oil field operations"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900/80 via-gray-900/30 to-transparent" />
        <div className="relative z-10 flex items-end justify-center p-12 w-full h-full">
          <div data-card-layout className="bg-[#242426] rounded-xl p-8 max-w-md border-2 border-[color:var(--brand-primary)]">
            <CardHeading as="h2" className="text-xl font-bold text-white mb-2">
              Field Management Elevated
            </CardHeading>
            <p className="text-sm text-white/85 leading-relaxed">
              VNDRLY bridges the gap between Partners, Vendors, and Field
              Employees with real-time GPS tracking and seamless work order
              management.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
