import { UserRound, X } from "lucide-react";
import type { ReactNode } from "react";

import { AppModalHeader, APP_MODAL_HEADER_ICON_CLASSNAME } from "@/components/app-modal-header";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
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

  return (
    <DialogContent
      bare
      hideClose
      accentHeaderStyle={{ display: "none" }}
      className={className}
      data-testid={testId}
    >
      <AppModalHeader
        closeControl={
          <DialogClose asChild>
            <button
              type="button"
              className={APP_MODAL_HEADER_ICON_CLASSNAME}
              aria-label="Close"
              data-testid="employee-dialog-close"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogClose>
        }
        description={description ? <DialogDescription>{description}</DialogDescription> : null}
        icon={UserRound}
        iconColor={brand.primary}
        logo={{ testId: "employee-dialog-logo" }}
        testId="employee-dialog-header"
        title={<DialogTitle>{title}</DialogTitle>}
      />
      <div
        className={cn(
          "relative z-10 grid min-h-0 flex-1 gap-4 overflow-y-auto bg-[#d1d5db] p-6 text-gray-900",
          "[&_input]:!rounded-xl [&_input]:!border-2 [&_input]:!border-[color:var(--brand-primary)] [&_input]:!bg-white [&_input]:!text-gray-700 [&_input::placeholder]:!text-gray-500",
          "[&_textarea]:!rounded-xl [&_textarea]:!border-2 [&_textarea]:!border-[color:var(--brand-primary)] [&_textarea]:!bg-white [&_textarea]:!text-gray-700 [&_textarea::placeholder]:!text-gray-500",
          "[&_select]:!rounded-xl [&_select]:!border-2 [&_select]:!border-[color:var(--brand-primary)] [&_select]:!bg-white [&_select]:!text-gray-700",
          "[&_[role=combobox]]:!rounded-xl [&_[role=combobox]]:!border-2 [&_[role=combobox]]:!border-[color:var(--brand-primary)] [&_[role=combobox]]:!bg-white [&_[role=combobox]]:!text-gray-700",
        )}
        style={{ colorScheme: "light" }}
        data-testid="employee-dialog-body"
      >
        {children}
      </div>
    </DialogContent>
  );
}
