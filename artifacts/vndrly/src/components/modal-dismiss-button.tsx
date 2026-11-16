import { useTranslation } from "react-i18next";
import type { ButtonHTMLAttributes } from "react";

export function ModalDismissButton({ label, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label?: string }) {
  const { t } = useTranslation();
  return <button {...props} type="button" className={`vendor-mini-card-button modal-dismiss-button ${props.className ?? ""}`}>
    {label ?? t("common.cancel", { defaultValue: "Cancel" })}
  </button>;
}
