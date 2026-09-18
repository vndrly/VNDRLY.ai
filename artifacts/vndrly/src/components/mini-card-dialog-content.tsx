import { Settings, X, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { AppModalHeader, APP_MODAL_HEADER_ICON_CLASSNAME } from "@/components/app-modal-header";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <DialogContent
      bare
      hideClose
      accentHeaderStyle={{ display: "none" }}
      className={className}
    >
      <AppModalHeader
        accentHeaderStyle={ASKV_HEADER_STYLE}
        closeControl={
          <DialogClose asChild>
            <button
              type="button"
              className={APP_MODAL_HEADER_ICON_CLASSNAME}
              aria-label="Close"
              data-testid="mini-card-dialog-close"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogClose>
        }
        description={<DialogDescription>{definition}</DialogDescription>}
        icon={Icon}
        iconColor={iconColor}
        logo={{ testId: "mini-card-dialog-logo" }}
        settings={
          settings ? (
            <button
              type="button"
              onClick={() => setSettingsOpen((value) => !value)}
              className={cn(APP_MODAL_HEADER_ICON_CLASSNAME, settingsOpen && "text-[color:var(--brand-primary)]")}
              aria-label="Flyout settings"
              aria-expanded={settingsOpen}
              data-testid="mini-card-dialog-settings"
            >
              <Settings className="h-4 w-4" />
            </button>
          ) : null
        }
        title={<DialogTitle>{label}</DialogTitle>}
        testId="mini-card-dialog-header"
        controlsTestId="mini-card-dialog-controls"
      />
      {settingsOpen && settings ? (
        <div
          className="relative z-10 shrink-0 border-b border-white/20 bg-[#3a3d42] px-4 py-2 text-white"
          data-testid="mini-card-dialog-settings-panel"
        >
          {settings}
        </div>
      ) : null}
      <div className="relative z-10 grid min-h-0 flex-1 gap-4 overflow-y-auto bg-[#d1d5db] p-6 text-gray-900" style={{ colorScheme: "light" }}>
        {children}
      </div>
    </DialogContent>
  );
}
