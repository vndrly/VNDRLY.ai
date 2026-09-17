import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PngPillButton } from "@/components/png-pill-rollover";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { useToast } from "@/hooks/use-toast";
import { translateApiError } from "@/lib/api-error";
import { EMPLOYEE_DIALOG_HEADER_STYLE } from "@/components/employee-dialog-content";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function ChangePasswordModal() {
  const { t } = useTranslation();
  const { user, clearMustChangePassword } = useAuth();
  const { toast } = useToast();
  const brand = useBrand();
  const logoUrl = brand.logoSquareUrl ?? brand.logoUrl;
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
      <DialogContent bare hideClose accentHeaderStyle={EMPLOYEE_DIALOG_HEADER_STYLE} className="max-w-sm" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader className="relative z-10 shrink-0 flex-row items-center gap-3 space-y-0 border-b border-white/20 bg-transparent px-3 pb-0 pt-[70px]" data-testid="change-password-header">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md" data-testid="change-password-logo">
            {logoUrl ? (
              <img src={logoUrl} alt={brand.name ? `${brand.name} logo` : "Company logo"} className="h-12 w-12 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]" />
            ) : (
              <span className="text-sm font-bold text-white drop-shadow-sm">{brand.name ?? "VNDRLY"}</span>
            )}
          </div>
          <KeyRound className="h-6 w-6 shrink-0" style={{ color: brand.primary }} aria-hidden />
          <div className="min-w-0 text-left">
            <DialogTitle className="text-white drop-shadow-sm">{t("changePassword.title")}</DialogTitle>
            <DialogDescription className="mt-1 text-xs text-white/80">{t("changePassword.description")}</DialogDescription>
          </div>
        </DialogHeader>
        <form onSubmit={submit} className="relative z-10 space-y-3 bg-background p-6" data-testid="change-password-body">
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
