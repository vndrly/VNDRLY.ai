import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { APP_MODAL_ALWAYS_DARK } from "./app-modal-tokens";

import "./platform-eula-modal.css";

export function VendorEditFlyout({ title, logoSrc, logoAlt, onClose, children, showHeaderImage = false, className = "" }: { title: string; logoSrc?: string; logoAlt: string; onClose: () => void; children: ReactNode; showHeaderImage?: boolean; className?: string }) {
  return <Dialog.Portal>
    <Dialog.Overlay className="platform-agreement-backdrop" />
    <Dialog.Content className={`platform-agreement-flyout vendor-edit-flyout ${className}`} aria-describedby={undefined}>
      {showHeaderImage && <div aria-hidden="true" className="platform-agreement-graphic" style={APP_MODAL_ALWAYS_DARK.accentHeaderStyle} />}
      <header className="platform-agreement-header">
        {logoSrc && <img className="platform-agreement-logo" src={logoSrc} alt={logoAlt} />}
        <div><Dialog.Title>{title}</Dialog.Title></div>
        <button type="button" data-modal-plain-control className="platform-agreement-close" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}><X size={18} /></button>
      </header>
      <div className="vendor-edit-flyout-body">{children}</div>
    </Dialog.Content>
  </Dialog.Portal>;
}
