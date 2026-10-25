import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PngPillButton } from "@/components/png-pill-rollover";

const endpoint = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/auth/admin-pin`;
export async function saveOrVerifyPin(body: { action: "create" | "verify"; pin: string; confirmPin?: string }) {
  const response = await fetch(endpoint, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Unable to verify PIN.");
}

export function PinFields({ pin, confirm, onPin, onConfirm }: { pin: string; confirm: string; onPin: (pin: string) => void; onConfirm: (pin: string) => void }) {
  const { t } = useTranslation();
  return <div className="grid grid-cols-2 gap-3">
    <label className="space-y-1 text-sm">{t("gateNav.createPin")}<Input type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={pin} onChange={e => onPin(e.target.value.replace(/\D/g, "").slice(0, 4))} /></label>
    <label className="space-y-1 text-sm">{t("gateNav.confirmPin")}<Input type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={confirm} onChange={e => onConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))} /></label>
  </div>;
}

export function AdminPinSetup({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const identity = user ? `${user.userId}:${user.activeMembershipId}` : "";
  const [checked, setChecked] = useState("");
  const [required, setRequired] = useState(false);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!identity || user?.offlineOnly) return;
    let cancelled = false;
    setError(""); setPin(""); setConfirm("");
    fetch(endpoint, { credentials: "include" }).then(async r => { if (!r.ok) throw Error(t("gateNav.pinLoadError")); return r.json(); })
      .then(data => { if (!cancelled) { setRequired(data.required === true); setChecked(identity); } })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [identity, user?.offlineOnly, retry, t]);
  if (!user || user.offlineOnly || user.mustChangePassword) return <>{children}</>;
  if (checked !== identity) return <div className="p-6 text-center">{error || t("gateNav.checkingPin")}{error && <PngPillButton onClick={() => setRetry(x => x + 1)}>{t("gateNav.retryPin")}</PngPillButton>}</div>;
  if (!required) return <>{children}</>;
  return <Dialog open><DialogContent hideClose className="sm:max-w-sm" onEscapeKeyDown={e => e.preventDefault()} onInteractOutside={e => e.preventDefault()}>
    <DialogHeader><DialogTitle>{t("gateNav.createPin")}</DialogTitle></DialogHeader>
    <DialogDescription>{t("gateNav.pinIntro")}</DialogDescription>
    <form className="space-y-4" onSubmit={async e => {
      e.preventDefault(); if (saving) return;
      if (!/^\d{4}$/.test(pin) || pin !== confirm) { setError(t("gateNav.pinMismatch")); return; }
      setSaving(true); setError("");
      try { await saveOrVerifyPin({ action: "create", pin, confirmPin: confirm }); setPin(""); setConfirm(""); setRequired(false); }
      catch (e) { setError((e as Error).message); } finally { setSaving(false); }
    }}>
      <PinFields pin={pin} confirm={confirm} onPin={setPin} onConfirm={setConfirm} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <PngPillButton type="submit" disabled={saving || pin.length !== 4 || confirm.length !== 4}>{t("gateNav.savePin")}</PngPillButton>
    </form>
  </DialogContent></Dialog>;
}
