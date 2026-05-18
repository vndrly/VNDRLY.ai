import { TogglePillButton } from "@/components/toggle-pill";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import BlueButton from "@/components/blue-button";
import RedButton from "@/components/red-button";
import GreenButton from "@/components/green-button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { translateApiError } from "@/lib/api-error";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type AccountActionsProps = {
  userId: number | null | undefined;
  hasLogin: boolean;
  suspendedAt: string | null;
  testIdPrefix: string;
  onChanged?: () => void;
};

/**
 * Renders Reset Password + Suspend/Reactivate controls for an admin to
 * manage a target user's account. Only visible if the target has a
 * linked user account (`hasLogin && userId`). Permission is enforced
 * server-side; we additionally hide the controls for non-admin
 * sessions to avoid showing dead UI.
 */
export default function AccountActions({ userId, hasLogin, suspendedAt, testIdPrefix, onChanged }: AccountActionsProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [resetOpen, setResetOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);

  if (!hasLogin || !userId) return null;
  // System Admin always sees; partner/vendor admins also see
  // (server enforces real authorization).
  const isAdmin = user?.role === "admin" || user?.role === "partner" || user?.role === "vendor";
  if (!isAdmin) return null;

  const isSuspended = !!suspendedAt;

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwd.length < 8) {
      toast({ title: t("accountActions.passwordTooShort"), variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/users/${userId}/admin-reset-password`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tempPassword: pwd }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || t("accountActions.resetFailed"));
      }
      toast({ title: t("accountActions.resetSuccess") });
      setPwd("");
      setResetOpen(false);
      onChanged?.();
    } catch (err: unknown) {
      toast({ title: translateApiError(err, t, t("accountActions.resetFailed")), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const submitSuspend = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/users/${userId}/suspend`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || t("accountActions.suspendFailed"));
      }
      toast({ title: t("accountActions.suspendSuccess") });
      setSuspendOpen(false);
      onChanged?.();
    } catch (err: unknown) {
      toast({ title: translateApiError(err, t, t("accountActions.suspendFailed")), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const submitReactivate = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/users/${userId}/reactivate`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || t("accountActions.reactivateFailed"));
      }
      toast({ title: t("accountActions.reactivateSuccess") });
      setReactivateOpen(false);
      onChanged?.();
    } catch (err: unknown) {
      toast({ title: translateApiError(err, t, t("accountActions.reactivateFailed")), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <TogglePillButton color="blue" type="button" onClick={() => setResetOpen(true)} data-testid={`${testIdPrefix}-reset-password`}>
        {t("accountActions.resetPassword")}
      </TogglePillButton>
      {isSuspended ? (
        <GreenButton type="button" onClick={() => setReactivateOpen(true)} data-testid={`${testIdPrefix}-reactivate`}>
          {t("accountActions.reactivate")}
        </GreenButton>
      ) : (
        <TogglePillButton color="red" type="button" onClick={() => setSuspendOpen(true)} data-testid={`${testIdPrefix}-suspend`}>
          {t("accountActions.suspend")}
        </TogglePillButton>
      )}

      {/* Reset password sub-modal */}
      <Dialog open={resetOpen} onOpenChange={(o) => { if (!busy) { setResetOpen(o); if (!o) setPwd(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("accountActions.resetPassword")}</DialogTitle>
            <DialogDescription>{t("accountActions.resetDescription")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitReset} className="space-y-3">
            <div>
              <Label htmlFor={`${testIdPrefix}-new-password`}>{t("accountActions.newPassword")}</Label>
              <Input
                id={`${testIdPrefix}-new-password`}
                type="text"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                autoFocus
                required
                minLength={8}
                data-testid={`${testIdPrefix}-new-password-input`}
              />
            </div>
            <TogglePillButton color="blue" type="submit" disabled={busy} className="w-full" data-testid={`${testIdPrefix}-reset-submit`}>
              {busy ? t("accountActions.sending") : t("accountActions.changePasswordAndEmail")}
            </TogglePillButton>
          </form>
        </DialogContent>
      </Dialog>

      {/* Suspend confirmation */}
      <AlertDialog open={suspendOpen} onOpenChange={(o) => { if (!busy) setSuspendOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("accountActions.suspendConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("accountActions.suspendConfirmDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`${testIdPrefix}-suspend-cancel`}>{t("accountActions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={submitSuspend} disabled={busy} data-testid={`${testIdPrefix}-suspend-confirm`}>
              {busy ? t("accountActions.sending") : t("accountActions.suspend")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reactivate confirmation */}
      <AlertDialog open={reactivateOpen} onOpenChange={(o) => { if (!busy) setReactivateOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("accountActions.reactivateConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("accountActions.reactivateConfirmDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`${testIdPrefix}-reactivate-cancel`}>{t("accountActions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={submitReactivate} disabled={busy} data-testid={`${testIdPrefix}-reactivate-confirm`}>
              {busy ? t("accountActions.sending") : t("accountActions.reactivate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function SuspendedPill({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200 ${className}`}
      data-testid="pill-suspended"
    >
      {t("accountActions.suspended")}
    </span>
  );
}

export function InactivePill({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200 ${className}`}
      data-testid="pill-inactive"
    >
      {t("accountActions.inactive")}
    </span>
  );
}
