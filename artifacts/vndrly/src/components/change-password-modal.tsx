import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound } from "lucide-react";
import { AppModalHeader } from "@/components/app-modal-header";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PngPillButton } from "@/components/png-pill-rollover";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { useToast } from "@/hooks/use-toast";
import { translateApiError } from "@/lib/api-error";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function ChangePasswordModal() {
  const { t } = useTranslation();
  const { user, clearMustChangePassword } = useAuth();
  const { toast } = useToast();
  const brand = useBrand();
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
      <DialogContent bare hideClose accentHeaderStyle={{ display: "none" }} className="max-w-sm" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <AppModalHeader
          description={<DialogDescription>{t("changePassword.description")}</DialogDescription>}
          icon={KeyRound}
          iconColor={brand.primary}
          logo={{ testId: "change-password-logo" }}
          testId="change-password-header"
          title={<DialogTitle>{t("changePassword.title")}</DialogTitle>}
        />
        <form onSubmit={submit} className="relative z-10 space-y-3 bg-[#d1d5db] p-6 text-gray-900" style={{ colorScheme: "light" }} data-testid="change-password-body">
          <div>
            <Label htmlFor="cp-new">{t("changePassword.newPassword")}</Label>
            <Input id="cp-new" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required minLength={8} className="rounded-xl border-2 bg-white text-gray-700 placeholder:text-gray-500" style={{ borderColor: brand.primary }} data-testid="input-change-password-new" />
          </div>
          <div>
            <Label htmlFor="cp-confirm">{t("changePassword.confirmPassword")}</Label>
            <Input id="cp-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} className="rounded-xl border-2 bg-white text-gray-700 placeholder:text-gray-500" style={{ borderColor: brand.primary }} data-testid="input-change-password-confirm" />
          </div>
          <PngPillButton color="brand" type="submit" disabled={busy} className="w-full justify-center" data-testid="button-change-password-submit">
            {busy ? t("changePassword.saving") : t("changePassword.submit")}
          </PngPillButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
