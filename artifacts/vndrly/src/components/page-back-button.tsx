import { useLocation } from "wouter";

import SphereBackButton from "@/components/sphere-back-button";
import { navigateBackInApp } from "@/lib/in-app-navigation";
import { cn } from "@/lib/utils";

type PageBackButtonProps = {
  fallbackHref: string;
  ariaLabel?: string;
  className?: string;
  size?: number;
  testId?: string;
};

export default function PageBackButton({
  fallbackHref,
  ariaLabel = "Back",
  className,
  size = 40,
  testId = "button-back",
}: PageBackButtonProps) {
  const [, navigate] = useLocation();
  return (
    <button
      type="button"
      onClick={() => navigateBackInApp(navigate, fallbackHref)}
      className={cn("group inline-flex items-center", className)}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      <SphereBackButton size={size} />
    </button>
  );
}
