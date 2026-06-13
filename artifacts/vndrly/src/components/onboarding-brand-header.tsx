import SphereBackButton from "@/components/sphere-back-button";
import { VNDRLY_LOGO_SQUARE as vndrlyLogo } from "@/lib/vndrly-brand-assets";
import { cn } from "@/lib/utils";
import logoUnderlay from "@assets/logo-underrlay_1778217900673.png";
import logoOverlay from "@assets/logo-overlay_1778217860263.png";

export interface OnboardingBrandPreview {
  name?: string | null;
  logoUrl?: string | null;
  logoSquareUrl?: string | null;
  primaryColor?: string | null;
}

interface OnboardingBrandHeaderProps {
  title: string;
  subtitle: string;
  preview?: OnboardingBrandPreview | null;
  onBack: () => void;
}

export function OnboardingBrandHeader({
  title,
  subtitle,
  preview,
  onBack,
}: OnboardingBrandHeaderProps): React.ReactElement {
  const logoSrc =
    preview?.logoSquareUrl?.trim() || preview?.logoUrl?.trim() || null;
  const hasOrgBrand = !!(logoSrc || preview?.primaryColor?.trim());

  return (
    <div className="flex items-start gap-3 mb-6">
      <button
        type="button"
        onClick={onBack}
        className="group inline-flex items-center shrink-0 mt-1"
        aria-label="Back"
        data-testid="button-back"
      >
        <SphereBackButton size={40} />
      </button>
      <div
        className={cn(
          "flex items-center gap-3 flex-1 min-w-0 transition-all duration-500",
          hasOrgBrand && "scale-[1.01]",
        )}
      >
        {hasOrgBrand && logoSrc ? (
          <div
            className="relative w-12 h-12 shrink-0 rounded-lg overflow-hidden ring-2 ring-[color:var(--brand-primary)]/40 transition-all duration-500"
            data-testid="onboarding-brand-logo-preview"
          >
            <img
              src={logoUnderlay}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover pointer-events-none opacity-50"
              draggable={false}
            />
            <img
              src={logoOverlay}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover pointer-events-none opacity-70"
              draggable={false}
            />
            <img
              src={logoSrc}
              alt=""
              className="absolute inset-0 w-full h-full object-contain p-1.5"
              draggable={false}
            />
          </div>
        ) : (
          <img
            src={vndrlyLogo}
            alt="VNDRLY"
            className="w-12 h-12 rounded-lg shrink-0"
            draggable={false}
          />
        )}
        <div className="min-w-0">
          <h1
            className={cn(
              "text-2xl font-bold text-gray-900 truncate transition-colors duration-500",
              hasOrgBrand && preview?.name && "text-[color:var(--brand-primary)]",
            )}
            data-testid="onboarding-brand-title"
          >
            {hasOrgBrand && preview?.name?.trim() ? preview.name.trim() : title}
          </h1>
          <p className="text-sm text-gray-500">
            {hasOrgBrand ? "Your brand is coming to life." : subtitle}
          </p>
        </div>
      </div>
    </div>
  );
}
