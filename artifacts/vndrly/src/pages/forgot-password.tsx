import { PngPillButton } from "@/components/png-pill-rollover";
import { useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { VNDRLY_LOGO_SQUARE as vndrlyLogo } from "@/lib/vndrly-brand-assets";
import headerBg from "@assets/VNDRLY_Header_Blur_4_1776220762025.png";
import AmberButton from "@/components/amber-button";
import GreyButton from "@/components/grey-button";
import DarkLightToggle, { type ThemeMode } from "@/components/dark-light-toggle";
import { cn } from "@/lib/utils";
import { translateApiError } from "@/lib/api-error";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const isDark = themeMode === "dark";
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const formReady = email.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err: Error & { data?: unknown; status?: number } = new Error(
          data.message || data.error || "Could not send reset email",
        );
        err.data = data;
        err.status = res.status;
        throw err;
      }
      setSent(true);
    } catch (err: unknown) {
      toast({
        title: translateApiError(err, t, t("errors.auth.password_reset_request_failed")),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col px-6 py-12 lg:px-16 relative" style={{ backgroundColor: isDark ? "#3a3d42" : "#f9fafb" }}>
      <div
        className="absolute top-0 left-0 right-0 pointer-events-none z-0"
        style={{
          backgroundImage: `url(${headerBg})`,
          backgroundSize: "cover",
          backgroundPosition: "center top",
          opacity: 0.85,
          height: "240px",
          maskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
        }}
      />
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
            <p className={cn("text-xs", isDark ? "text-gray-300" : "text-gray-500")}>Reset your password to regain access to your portal.</p>
          </div>

          {sent ? (
            <div className="border-2 border-amber-500 rounded-xl p-6 shadow-xl bg-white">
              <h2 className="text-lg font-bold text-gray-900 mb-2">Check your email</h2>
              <p className="text-sm text-gray-600 leading-relaxed">
                If an account exists for <span className="font-medium text-gray-900">{email}</span>, we've sent a password reset link. The link expires in 1 hour.
              </p>
              <div className="pt-5">
                <PngPillButton color="amber" type="button" className="w-full h-11" onClick={() => navigate("/login")} data-testid="button-back-to-login">
                  Back to Sign In
                </PngPillButton>
              </div>
            </div>
          ) : (
            <div className={`border-2 rounded-xl p-6 shadow-xl bg-white transition-colors duration-300 ${formReady ? "border-amber-500" : "border-gray-300"}`}>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-gray-700">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    autoComplete="email"
                    data-testid="input-forgot-email"
                    className="h-11"
                  />
                  <p className="text-xs text-gray-500">We'll email you a link to reset your password.</p>
                </div>
                <div className="pt-2">
                  {formReady ? (
                    <PngPillButton color="amber" type="submit" disabled={isSubmitting} className="w-full h-11" data-testid="button-send-reset">
                      {isSubmitting ? "Sending..." : "Send Reset Link"}
                    </PngPillButton>
                  ) : (
                    <PngPillButton type="submit" disabled className="w-full h-11" data-testid="button-send-reset">
                      Send Reset Link
                    </PngPillButton>
                  )}
                </div>
              </form>
            </div>
          )}

          <div className={cn("mt-4 pt-4 border-t text-center", isDark ? "border-white/20" : "border-gray-200")}>
            <a
              href="/login"
              className="font-semibold text-amber-600 hover:text-amber-700 underline underline-offset-2 text-sm"
              onClick={(e) => { e.preventDefault(); navigate("/login"); }}
              data-testid="link-back-to-login"
            >
              Back to Sign In
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
