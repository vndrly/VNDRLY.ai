import { Settings, X, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBrand } from "@/hooks/use-brand";
import { cn } from "@/lib/utils";

const ASKV_HEADER_STYLE = {
  position: "absolute",
  inset: "0 0 auto 0",
  width: "100%",
  height: 118,
  zIndex: 0,
  backgroundSize: "100% auto",
  WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 55%, transparent 100%)",
  maskImage: "linear-gradient(to bottom, black 0%, black 55%, transparent 100%)",
} as const;

const headerIconClassName = cn(
  "inline-flex h-9 w-9 items-center justify-center rounded-sm text-gray-300 transition-colors select-none",
  "hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
);

export default function MiniCardDialogContent({
  icon: Icon,
  label,
  definition,
  iconColor,
  settings,
  children,
  className,
}: {
  icon: LucideIcon;
  label: string;
  definition: string;
  iconColor: string;
  settings?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const brand = useBrand();
  const logoUrl = brand.logoSquareUrl ?? brand.logoUrl;
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <DialogContent
      bare
      hideClose
      accentHeaderStyle={ASKV_HEADER_STYLE}
      className={className}
    >
      <DialogHeader
        className="relative z-10 shrink-0 flex-row items-center justify-between gap-3 space-y-0 border-b border-white/20 bg-transparent px-3 pb-0 pt-[70px]"
        data-testid="mini-card-dialog-header"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md"
            data-testid="mini-card-dialog-logo"
          >
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={brand.name ? `${brand.name} logo` : "Company logo"}
                className="h-12 w-12 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]"
              />
            ) : (
              <span className="text-sm font-bold text-white drop-shadow-sm">
                {brand.name ?? "VNDRLY"}
              </span>
            )}
          </div>
          <Icon className="h-6 w-6 shrink-0" style={{ color: iconColor }} />
          <div className="min-w-0 text-left">
            <DialogTitle className="text-white drop-shadow-sm">{label}</DialogTitle>
            <DialogDescription className="mt-1 text-xs text-white/80">
              {definition}
            </DialogDescription>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1" data-testid="mini-card-dialog-controls">
          {settings ? (
            <button
              type="button"
              onClick={() => setSettingsOpen((value) => !value)}
              className={cn(headerIconClassName, settingsOpen && "text-[color:var(--brand-primary)]")}
              aria-label="Flyout settings"
              aria-expanded={settingsOpen}
              data-testid="mini-card-dialog-settings"
            >
              <Settings className="h-4 w-4" />
            </button>
          ) : null}
          <DialogClose asChild>
            <button
              type="button"
              className={headerIconClassName}
              aria-label="Close"
              data-testid="mini-card-dialog-close"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogClose>
        </div>
      </DialogHeader>
      {settingsOpen && settings ? (
        <div
          className="relative z-10 shrink-0 border-b border-white/20 bg-[#3a3d42] px-4 py-2 text-white"
          data-testid="mini-card-dialog-settings-panel"
        >
          {settings}
        </div>
      ) : null}
      <div className="relative z-10 grid min-h-0 flex-1 gap-4 overflow-y-auto bg-background p-6">
        {children}
      </div>
    </DialogContent>
  );
}