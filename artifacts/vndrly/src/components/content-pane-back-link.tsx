import { Link } from "wouter";
import { cn } from "@/lib/utils";
import SphereBackButton from "@/components/sphere-back-button";

interface ContentPaneBackLinkProps {
  href?: string;
  onClick?: () => void;
  size?: number;
  className?: string;
  testId?: string;
  ariaLabel?: string;
}

/** Glossy sphere back control for main / field-ops content pane page headers. */
export default function ContentPaneBackLink({
  href = "/",
  onClick,
  size = 40,
  className,
  testId = "button-back",
  ariaLabel = "Back",
}: ContentPaneBackLinkProps) {
  const wrapperClass = cn("group inline-flex items-center shrink-0", className);

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={wrapperClass}
        aria-label={ariaLabel}
        data-testid={testId}
      >
        <SphereBackButton size={size} />
      </button>
    );
  }

  return (
    <Link
      href={href}
      className={wrapperClass}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      <SphereBackButton size={size} />
    </Link>
  );
}
