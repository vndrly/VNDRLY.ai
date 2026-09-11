import type { ComponentType, ReactNode, SelectHTMLAttributes, SVGProps } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { workHubIcons } from "@/lib/work-hub-nav";
import { CARD_TITLE_ICON_CLASS } from "@/components/ui/card";

export type WorkHubModuleKey = keyof typeof workHubIcons;
type HubIcon = ComponentType<SVGProps<SVGSVGElement>>;

export const WORK_HUB_CARD_CLASS =
  "rounded-xl border-2 border-[color:var(--brand-primary)] bg-card shadow-sm";
export const WORK_HUB_SUBCARD_CLASS =
  "rounded-xl border-2 border-[color:var(--brand-primary)] bg-background";

export function WorkHubSurface({ children }: { children: ReactNode }) {
  return (
    <div className="work-hub-surface [&_[data-slot=card]]:!border-[color:var(--brand-primary)] [&_[data-work-hub-card]]:!border-[color:var(--brand-primary)] [&_[data-slot=card-title]]:font-bold [&_[data-slot=card-title]]:text-black [&_[data-slot=card-title]_svg]:text-[var(--brand-primary)]">
      {children}
    </div>
  );
}

export function WorkHubPageHeading({
  module,
  title,
  description,
  actions,
  compact = false,
  className,
}: {
  module: WorkHubModuleKey;
  title: string;
  description?: string;
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const Icon = workHubIcons[module];
  return (
    <header className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      <div className="flex min-w-0 items-start gap-2">
        <Icon
          aria-hidden="true"
          data-work-hub-heading-icon={module}
          className={cn(
            "shrink-0 text-[var(--brand-primary)] card-icon-drop-shadow",
            compact ? "h-5 w-5" : "h-6 w-6",
          )}
        />
        <div className="min-w-0">
          <h1
            className={cn(
              "font-bold leading-none text-[var(--brand-primary)]",
              compact ? "text-xl" : "text-2xl",
            )}
          >
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {actions}
    </header>
  );
}

export function WorkHubCardTitle({
  icon: Icon,
  children,
  className,
}: {
  icon: HubIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("flex items-start gap-2 text-base font-bold text-black", className)}>
      <Icon aria-hidden="true" className={cn(CARD_TITLE_ICON_CLASS, "text-[var(--brand-primary)]")} />
      <span>{children}</span>
    </span>
  );
}

export function BrandedSelect({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block min-w-0">
      <select
        className={cn(
          "h-9 w-full appearance-none rounded-lg border-2 border-[color:var(--brand-primary)] bg-background px-3 pr-8 text-sm text-foreground outline-none focus:ring-2 focus:ring-[color:var(--brand-primary)]/25",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--brand-primary)]"
      />
    </span>
  );
}
