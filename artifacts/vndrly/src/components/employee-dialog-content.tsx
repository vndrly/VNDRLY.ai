import { UserRound, X } from "lucide-react";
import type { ReactNode } from "react";

import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBrand } from "@/hooks/use-brand";
import { cn } from "@/lib/utils";

export const EMPLOYEE_DIALOG_HEADER_STYLE = {
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

export default function EmployeeDialogContent({
  title,
  description,
  children,
  className,
  testId,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const brand = useBrand();
  const logoUrl = brand.logoSquareUrl ?? brand.logoUrl;

  return (
    <DialogContent
      bare
      hideClose
      accentHeaderStyle={EMPLOYEE_DIALOG_HEADER_STYLE}
      className={className}
      data-testid={testId}
    >
      <DialogHeader
        className="relative z-10 shrink-0 flex-row items-center justify-between gap-3 space-y-0 border-b border-white/20 bg-transparent px-3 pb-0 pt-[70px]"
        data-testid="employee-dialog-header"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md"
            data-testid="employee-dialog-logo"
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
          <UserRound
            className="h-6 w-6 shrink-0"
            style={{ color: brand.primary }}
            aria-hidden
          />
          <div className="min-w-0 text-left">
            <DialogTitle className="text-white drop-shadow-sm">{title}</DialogTitle>
            {description ? (
              <DialogDescription className="mt-1 text-xs text-white/80">
                {description}
              </DialogDescription>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <DialogClose asChild>
            <button
              type="button"
              className={headerIconClassName}
              aria-label="Close"
              data-testid="employee-dialog-close"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogClose>
        </div>
      </DialogHeader>
      <div
        className={cn(
          "relative z-10 grid min-h-0 flex-1 gap-4 overflow-y-auto bg-background p-6",
          "[&_input]:!rounded-xl [&_input]:!border-2 [&_input]:!border-[color:var(--brand-primary)] [&_input]:!bg-white [&_input]:!text-gray-700 [&_input::placeholder]:!text-gray-500",
          "[&_textarea]:!rounded-xl [&_textarea]:!border-2 [&_textarea]:!border-[color:var(--brand-primary)] [&_textarea]:!bg-white [&_textarea]:!text-gray-700 [&_textarea::placeholder]:!text-gray-500",
          "[&_select]:!rounded-xl [&_select]:!border-2 [&_select]:!border-[color:var(--brand-primary)] [&_select]:!bg-white [&_select]:!text-gray-700",
          "[&_[role=combobox]]:!rounded-xl [&_[role=combobox]]:!border-2 [&_[role=combobox]]:!border-[color:var(--brand-primary)] [&_[role=combobox]]:!bg-white [&_[role=combobox]]:!text-gray-700",
        )}
        data-testid="employee-dialog-body"
      >
        {children}
      </div>
    </DialogContent>
  );
}