import { ModalDismissButton } from "./modal-dismiss-button";
import * as Dialog from "@/components/ui/task-dialog-primitives";
import { X } from "lucide-react";
import "./platform-eula-modal.css";

import { VNDRLY_LOGO_SQUARE } from "@/lib/vndrly-brand-assets";
import { APP_MODAL_ALWAYS_DARK } from "./app-modal-tokens";
import {
  PLATFORM_EULA_LAST_UPDATED,
  PLATFORM_EULA_PRIVACY_URL,
  PLATFORM_EULA_TEXT,

  PLATFORM_EULA_VERSION,
} from "@workspace/platform-eula";

interface PlatformEulaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Read-only agreement in the branded card flyout treatment. */
export function PlatformEulaModal({ open, onOpenChange }: PlatformEulaModalProps): React.ReactElement {

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="platform-agreement-backdrop" />
        <Dialog.Content className="platform-agreement-flyout" data-testid="modal-platform-eula" aria-describedby="platform-agreement-version">
          <div aria-hidden="true" className="platform-agreement-graphic" style={APP_MODAL_ALWAYS_DARK.accentHeaderStyle} />
          <header className="platform-agreement-header">
            <img className="platform-agreement-logo" src={VNDRLY_LOGO_SQUARE} alt="VNDRLY" />
            <div>
              <Dialog.Title>End User License Agreement</Dialog.Title>
              <Dialog.Description id="platform-agreement-version">
                Version {PLATFORM_EULA_VERSION} · Last updated {PLATFORM_EULA_LAST_UPDATED}
              </Dialog.Description>
            </div>
            <Dialog.Close className="platform-agreement-close" aria-label="Close platform agreement"><X size={18} /></Dialog.Close>
          </header>
          <div className="platform-agreement-text" tabIndex={0} role="region" aria-label="Agreement text">
            {PLATFORM_EULA_TEXT}
          </div>
          <footer className="flex shrink-0 items-center justify-between gap-3"><a href={PLATFORM_EULA_PRIVACY_URL} target="_blank" rel="noopener noreferrer">Privacy policy</a><Dialog.Close asChild><ModalDismissButton label="Close" /></Dialog.Close></footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
