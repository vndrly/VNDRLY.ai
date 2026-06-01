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
}

export default function OnboardingVerificationBanner({
  email,
  emailVerifiedAt,
  onResent,
}: OnboardingVerificationBannerProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [sending, setSending] = useState(false);

  if (!email) return null;

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
