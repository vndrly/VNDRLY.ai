import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, MailWarning } from "lucide-react";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { useToast } from "@/hooks/use-toast";
import { onboardingApi } from "@/lib/onboarding-api";

export interface OnboardingVerificationBannerProps {
  email: string | null;
  emailVerifiedAt: string | null;
  onResent?: () => void;
  compact?: boolean;
}

export default function OnboardingVerificationBanner({
  email,
  emailVerifiedAt,
  onResent,
  compact = false,
}: OnboardingVerificationBannerProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"sent" | "verified" | null>(null);

  if (!email) return null;

  if (compact && (emailVerifiedAt || status)) {
    return <span role="status" className="vendor-mini-card">{emailVerifiedAt || status === "verified" ? "Email Verified" : "Verification Sent"}</span>;
  }
  if (emailVerifiedAt) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 mb-4"
        data-testid="banner-email-verified"
      >
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        <span>{t("verifyEmail.verified", { defaultValue: "Email verified" })}</span>
      </div>
    );
  }

  const handleResend = async () => {
    setSending(true);
    try {
      const r = await onboardingApi.resendVerification();
      if (r.alreadyVerified) {
        toast({
          title: t("verifyEmail.alreadyVerifiedTitle", {
            defaultValue: "Already verified",
          }),
        });
      } else {
        toast({
          title: t("verifyEmail.sentTitle", { defaultValue: "Verification email sent" }),
          description: t("verifyEmail.sentDescription", {
            defaultValue: "Check {{email}} for the confirmation link.",
            email,
          }),
        });
      }
      setStatus(r.alreadyVerified ? "verified" : "sent");
      setOpen(false);
      onResent?.();
    } catch (err) {
      toast({
        title: t("verifyEmail.failedTitle", {
          defaultValue: "Couldn't resend verification email",
        }),
        description:
          err instanceof Error
            ? err.message
            : t("verifyEmail.failedDescription", {
                defaultValue: "Please try again in a moment.",
              }),
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  if (compact) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="vendor-mini-card-button">Verify Email</button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 max-w-[calc(100vw-24px)]">
          <form className="space-y-3 rounded-lg border border-[var(--brand-primary)] bg-[#242426] p-3 text-[#ececec]" onSubmit={(event) => { event.preventDefault(); void handleResend(); }}>
            <label className="block space-y-1 text-sm">
              <span>Account email</span>
              <input type="email" value={email} readOnly className="w-full rounded border border-[#707075] bg-[#303034] p-2 text-[#ececec]" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="submit" className="vendor-mini-card-button" disabled={sending}>{sending ? "Sending…" : "Verify"}</button>
              <button type="button" className="vendor-mini-card-button" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <div
      className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900 mb-4"
      data-testid="banner-email-unverified"
    >
      <MailWarning className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="font-medium">
          {t("verifyEmail.title", { defaultValue: "Confirm your email" })}
        </p>
        <p className="text-amber-800">
          {t("verifyEmail.body", {
            defaultValue:
              "We sent a confirmation link to {{email}}. Click it to verify your account — this helps prove you're not a bot. You can keep onboarding while you wait.",
            email,
          })}
        </p>
      </div>
      <PillButton
        color="image"
        onClick={handleResend}
        disabled={sending}
        data-testid="button-resend-verification"
      >
        {sending
          ? t("verifyEmail.sending", { defaultValue: "Sending…" })
          : t("verifyEmail.resend", { defaultValue: "Resend" })}
      </PillButton>
    </div>
  );
}
