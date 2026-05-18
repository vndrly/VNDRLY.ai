import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TogglePillButton } from "@/components/toggle-pill";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { translateApiError } from "@/lib/api-error";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function ChangePasswordModal() {
  const { t } = useTranslation();
  const { user, clearMustChangePassword } = useAuth();
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  if (!user || !user.mustChangePassword) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast({ title: t("changePassword.tooShort"), variant: "destructive" });
      return;
    }
    if (password !== confirm) {
      toast({ title: t("changePassword.mismatch"), variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/auth/change-password`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: password }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || t("changePassword.failed"));
      }
      toast({ title: t("changePassword.success") });
      setPassword("");
      setConfirm("");
      clearMustChangePassword();
    } catch (err: unknown) {
      toast({ title: translateApiError(err, t, t("changePassword.failed")), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={() => { /* blocking — cannot dismiss */ }}>
      <DialogContent className="max-w-sm" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t("changePassword.title")}</DialogTitle>
          <DialogDescription>{t("changePassword.description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label htmlFor="cp-new">{t("changePassword.newPassword")}</Label>
            <Input id="cp-new" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required minLength={8} data-testid="input-change-password-new" />
          </div>
          <div>
            <Label htmlFor="cp-confirm">{t("changePassword.confirmPassword")}</Label>
            <Input id="cp-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} data-testid="input-change-password-confirm" />
          </div>
          <TogglePillButton color="blue" type="submit" disabled={busy} className="w-full justify-center" data-testid="button-change-password-submit">
            {busy ? t("changePassword.saving") : t("changePassword.submit")}
          </TogglePillButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
