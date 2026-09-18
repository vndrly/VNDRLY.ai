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
};

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
}: AppModalHeaderProps) {
  const brand = useBrand();
  const effectiveLogo = logo ?? {
    src: brand.logoSquareUrl ?? brand.logoUrl,
    alt: brand.name ? `${brand.name} logo` : "Company logo",
    fallbackName: brand.name ?? "VNDRLY",
  };

  return (
    <div
      className={cn(
        "relative z-10 min-h-[118px] shrink-0 overflow-hidden border-b border-white/20",
        className,
      )}
      data-testid="app-modal-header"
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
          height: 118,
          backgroundSize: "100% auto",
          WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 55%, transparent 100%)",
          maskImage: "linear-gradient(to bottom, black 0%, black 55%, transparent 100%)",
          ...accentHeaderStyle,
        }}
      />
      <div className="relative z-10 flex min-h-[118px] items-end gap-3 px-3 pb-0 pr-24">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md">
          {effectiveLogo.src ? (
            <img
              alt={effectiveLogo.alt ?? effectiveLogo.fallbackName ?? "Company logo"}
              className="h-12 w-12 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]"
              data-testid={effectiveLogo.testId ?? "app-modal-header-logo"}
              src={effectiveLogo.src}
            />
          ) : (
            <span
              className="text-sm font-bold text-white drop-shadow-sm"
              data-testid={effectiveLogo.testId ?? "app-modal-header-logo"}
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
        <div className="min-w-0 flex-1 pb-2 text-left">
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
        data-testid="app-modal-header-controls"
      >
        {settings}
        {closeControl}
      </div>
    </div>
  );
}
