import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import SphereBackButton from "@/components/sphere-back-button";
import { navigateBackInApp } from "@/lib/in-app-navigation";

interface ContentPaneBackLinkProps {
  href?: string;
  onClick?: () => void;
  size?: number;
  className?: string;
  testId?: string;
  ariaLabel?: string;
}

/** Back follows page history; href is only the safe direct-entry fallback.
 * Explicit callbacks remain actions (for example closing an editor). */
export default function ContentPaneBackLink({
  href = "/",
  onClick,
  size = 40,
  className,
  testId = "button-back",
  ariaLabel = "Back",
}: ContentPaneBackLinkProps) {
  const [, navigate] = useLocation();
  const wrapperClass = cn("group inline-flex items-center shrink-0", className);

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={wrapperClass}
        aria-label={ariaLabel}
        data-testid={testId}
        data-page-back
      >
        <SphereBackButton size={size} />
      </button>
    );
  }

  return (
    <Link
      href={href}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigateBackInApp(navigate, href);
      }}
      className={wrapperClass}
      aria-label={ariaLabel}
      data-testid={testId}
      data-page-back
    >
      <SphereBackButton size={size} />
    </Link>
  );
}
