import { PngPillButton } from "@/components/png-pill-rollover";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { VNDRLY_LOGO_SQUARE as vndrlyLogo } from "@/lib/vndrly-brand-assets";
import { NAV_PANE_DARK_BG } from "@/components/nav-pane-tokens";
import { NavPaneHalftoneBackground } from "@/components/nav-pane-halftone-background";
import { NavPaneHeaderBlur } from "@/components/nav-pane-header-blur";
import AmberButton from "@/components/amber-button";
import GreyButton from "@/components/grey-button";
import DarkLightToggle, { type ThemeMode } from "@/components/dark-light-toggle";
import { cn } from "@/lib/utils";
import { translateApiError } from "@/lib/api-error";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function ResetPassword() {
  const { t: tr } = useTranslation();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [token, setToken] = useState("");
  const [validating, setValidating] = useState(true);
  const [valid, setValid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const isDark = themeMode === "dark";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token") || "";
    setToken(t);
    if (!t) {
      setValid(false);
      setValidating(false);
      return;
    }
    fetch(`${BASE}/api/auth/reset-password/validate?token=${encodeURIComponent(t)}`)
      .then((r) => r.json())
      .then((d) => setValid(!!d.valid))
      .catch(() => setValid(false))
      .finally(() => setValidating(false));
  }, []);

  const formReady = password.length >= 8 && password === confirm;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formReady) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err: Error & { data?: unknown; status?: number } = new Error(
          data.message || data.error || "Could not reset password",
        );
        err.data = data;
        err.status = res.status;
        throw err;
      }
      setDone(true);
    } catch (err: unknown) {
      toast({
        title: translateApiError(err, tr, tr("errors.auth.password_reset_failed")),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col px-6 py-12 lg:px-16 relative overflow-hidden" style={{ backgroundColor: isDark ? NAV_PANE_DARK_BG : "#f9fafb" }}>
      <NavPaneHalftoneBackground enabled={isDark} variant="auth" />
      {isDark && <NavPaneHeaderBlur height={240} />}
      <div className="absolute top-4 left-4 z-20">
        <DarkLightToggle mode={themeMode} onChange={setThemeMode} variant={isDark ? "dark" : "light"} />
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-md relative z-10">
          <div className="flex items-center gap-3 mb-3">
            <img src={vndrlyLogo} alt="VNDRLY Logo" className="w-12 h-12 rounded-lg shrink-0" draggable={false} />
            <div className="flex-1 min-w-0">
              <h1 className={cn("text-2xl font-bold tracking-tight leading-none", isDark ? "text-white" : "text-gray-900")}>VNDRLY</h1>
              <p className={cn("text-sm font-semibold leading-tight mt-1", isDark ? "text-gray-200" : "text-gray-700")}>Field Employee Portal</p>
            </div>
          </div>
          <div className="mb-8">
            <p className={cn("text-xs", isDark ? "text-gray-300" : "text-gray-500")}>Choose a new password for your portal account.</p>
          </div>

          {validating ? (
            <div className="border-2 border-gray-300 rounded-xl p-6 shadow-xl bg-white text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500 mx-auto" />
              <p className="text-sm text-gray-500 mt-3">Validating reset link…</p>
            </div>
          ) : !valid ? (
            <div className="border-2 border-red-400 rounded-xl p-6 shadow-xl bg-white">
              <h2 className="text-lg font-bold text-gray-900 mb-2">Link Invalid or Expired</h2>
              <p className="text-sm text-gray-600 leading-relaxed">
                This reset link is no longer valid. Please request a new one.
              </p>
              <div className="pt-5">
                <PngPillButton color="amber" type="button" className="w-full h-11" onClick={() => navigate("/forgot-password")} data-testid="button-request-new">
                  Request a New Link
                </PngPillButton>
              </div>
            </div>
          ) : done ? (
            <div className="border-2 border-amber-500 rounded-xl p-6 shadow-xl bg-white">
              <h2 className="text-lg font-bold text-gray-900 mb-2">Password Updated</h2>
              <p className="text-sm text-gray-600 leading-relaxed">
                Your password was updated successfully. You can now sign in with your new password.
              </p>
              <div className="pt-5">
                <PngPillButton color="amber" type="button" className="w-full h-11" onClick={() => navigate("/login")} data-testid="button-go-to-login">
                  Go to Sign In
                </PngPillButton>
              </div>
            </div>
          ) : (
            <div className={`border-2 rounded-xl p-6 shadow-xl bg-white transition-colors duration-300 ${formReady ? "border-amber-500" : "border-gray-300"}`}>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="new-password" className="text-gray-700">New Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    data-testid="input-new-password"
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password" className="text-gray-700">Confirm Password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Re-enter password"
                    autoComplete="new-password"
                    data-testid="input-confirm-password"
                    className="h-11"
                  />
                  {confirm.length > 0 && password !== confirm && (
                    <p className="text-xs text-red-600">Passwords do not match.</p>
                  )}
                </div>
                <div className="pt-2">
                  {formReady ? (
                    <PngPillButton color="amber" type="submit" disabled={isSubmitting} className="w-full h-11" data-testid="button-set-password">
                      {isSubmitting ? "Updating..." : "Set New Password"}
                    </PngPillButton>
                  ) : (
                    <PngPillButton type="submit" disabled className="w-full h-11" data-testid="button-set-password">
                      Set New Password
                    </PngPillButton>
                  )}
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
