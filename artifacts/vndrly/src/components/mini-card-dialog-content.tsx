import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBrand } from "@/hooks/use-brand";

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

export default function MiniCardDialogContent({
  icon: Icon,
  label,
  definition,
  iconColor,
  children,
  className,
}: {
  icon: LucideIcon;
  label: string;
  definition: string;
  iconColor: string;
  children: ReactNode;
  className?: string;
}) {
  const brand = useBrand();
  const logoUrl = brand.logoUrl ?? brand.logoSquareUrl;

  return (
    <DialogContent
      bare
      accentHeaderStyle={ASKV_HEADER_STYLE}
      className={className}
    >
      <DialogHeader
        className="relative z-10 shrink-0 flex-row items-center gap-3 space-y-0 border-b border-white/20 bg-transparent px-4 pb-3 pt-[70px]"
        data-testid="mini-card-dialog-header"
      >
        <div
          className="flex h-12 min-w-12 shrink-0 items-center justify-center"
          data-testid="mini-card-dialog-logo"
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={brand.name ? `${brand.name} logo` : "Company logo"}
              className="max-h-12 max-w-28 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]"
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
      </DialogHeader>
      <div className="relative z-10 grid min-h-0 flex-1 gap-4 overflow-y-auto bg-background p-6">
        {children}
      </div>
    </DialogContent>
  );
}
