import { useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PngPillButton } from "@/components/png-pill-rollover";

export function ReturnToAdminPinDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [, navigate] = useLocation();
  const { t } = useTranslation();
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  function close() { setPin(""); setPinError(false); onOpenChange(false); }
  return <Dialog open={open} onOpenChange={(next) => { if (!next) close(); else onOpenChange(true); }}>
    <DialogContent className="sm:max-w-sm">
      <DialogHeader><DialogTitle>{t("gateNav.returnToAdmin")}</DialogTitle></DialogHeader>
      <form className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        if (pin !== "1029") { setPinError(true); return; }
        close();
        navigate("/");
      }}>
        <label htmlFor="gate-return-pin">{t("gateNav.enterPin")}</label>
        <Input id="gate-return-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={4} autoFocus
          value={pin} onChange={(event) => { setPin(event.target.value.replace(/\D/g, "").slice(0, 4)); setPinError(false); }}
          aria-invalid={pinError} aria-describedby={pinError ? "gate-return-pin-error" : undefined} />
        {pinError && <p id="gate-return-pin-error" role="alert" className="text-sm text-destructive">{t("gateNav.incorrectPin")}</p>}
        <PngPillButton type="submit" disabled={pin.length !== 4}>{t("gateNav.returnToAdmin")}</PngPillButton>
      </form>
    </DialogContent>
  </Dialog>;
}
