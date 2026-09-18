import type { CSSProperties, ElementType, ReactNode } from "react";

import { APP_MODAL_ALWAYS_DARK } from "@/components/app-modal-tokens";
import { useBrand } from "@/hooks/use-brand";
import { cn } from "@/lib/utils";

export type AppModalLogoSpec = {
  src?: string | null;
  alt?: string;
  fallbackName?: string | null;
  testId?: string;
};

export type AppModalHeaderProps = {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ElementType;
  iconColor?: string;
  logo?: AppModalLogoSpec | null;
  settings?: ReactNode;
  closeControl?: ReactNode;
  children?: ReactNode;
  className?: string;
  accentHeaderStyle?: CSSProperties;
  compact?: boolean;
  testId?: string;
  controlsTestId?: string;
};

export const APP_MODAL_HEADER_ICON_CLASSNAME = cn(
  "inline-flex h-9 w-9 items-center justify-center rounded-sm text-gray-300 transition-colors select-none",
  "hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
);

export function AppModalHeader({
  title,
  description,
  icon: Icon,
  iconColor,
  logo,
  settings,
  closeControl,
  children,
  className,
  accentHeaderStyle,
  compact = false,
  testId = "app-modal-header",
  controlsTestId = "app-modal-header-controls",
}: AppModalHeaderProps) {
  const brand = useBrand();
  const defaultLogo: AppModalLogoSpec = {
    src: brand.logoSquareUrl ?? brand.logoUrl,
    alt: brand.name ? `${brand.name} logo` : "Company logo",
    fallbackName: brand.name ?? "VNDRLY",
  };
  const effectiveLogo = { ...defaultLogo, ...logo };

  return (
    <div
      className={cn(
        "relative z-10 shrink-0 overflow-hidden border-b border-white/20",
        "[&_[data-slot=dialog-description]]:!text-white/80 [&_[data-slot=dialog-title]]:!text-white",
        compact ? "h-16 min-h-16" : "min-h-[118px]",
        className,
      )}
      data-testid={testId}
    >
      <div
        aria-hidden
        className={APP_MODAL_ALWAYS_DARK.accentHeaderClassName}
        data-testid="modal-accent-header"
        style={{
          ...APP_MODAL_ALWAYS_DARK.accentHeaderStyle,
          position: "absolute",
          inset: "0 0 auto 0",
          width: "100%",
          height: compact ? 64 : 118,
          backgroundSize: "100% auto",
          WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 55%, transparent 100%)",
          maskImage: "linear-gradient(to bottom, black 0%, black 55%, transparent 100%)",
          ...accentHeaderStyle,
        }}
      />
      <div
        className={cn(
          "relative z-10 flex gap-3 px-3 pr-24",
          compact ? "min-h-16 items-center" : "min-h-[118px] items-end pb-0",
        )}
      >
        <div
          className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-md", compact ? "h-10 w-10" : "h-12 w-12")}
          data-testid={effectiveLogo.testId ?? "app-modal-header-logo"}
        >
          {effectiveLogo.src ? (
            <img
              alt={effectiveLogo.alt ?? effectiveLogo.fallbackName ?? "Company logo"}
              className={cn("object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]", compact ? "h-10 w-10" : "h-12 w-12")}
              src={effectiveLogo.src}
            />
          ) : (
            <span
              className="text-sm font-bold text-white drop-shadow-sm"
            >
              {effectiveLogo.fallbackName ?? "VNDRLY"}
            </span>
          )}
        </div>
        {Icon ? (
          <Icon
            aria-hidden="true"
            className="mb-3 h-6 w-6 shrink-0"
            style={{ color: iconColor ?? "var(--brand-primary)" }}
          />
        ) : null}
        <div className={cn("min-w-0 flex-1 text-left", !compact && "pb-2")}>
          {children ?? (
            <>
              {title ? <div className="text-lg font-semibold text-white drop-shadow-sm">{title}</div> : null}
              {description ? <div className="mt-1 text-xs text-white/80">{description}</div> : null}
            </>
          )}
        </div>
      </div>
      <div
        className="absolute right-4 top-4 z-30 flex items-center gap-1"
        data-testid={controlsTestId}
      >
        {settings}
        {closeControl}
      </div>
    </div>
  );
}
