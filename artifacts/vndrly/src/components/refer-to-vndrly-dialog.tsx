import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Send, UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PngPillButton } from "@/components/png-pill-rollover";
import { useToast } from "@/hooks/use-toast";
import { onboardingApi } from "@/lib/onboarding-api";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ReferToVndrlyDialogProps {
  trigger: React.ReactNode;
}

export function ReferToVndrlyDialog({ trigger }: ReferToVndrlyDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string>("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError("");
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !EMAIL_RE.test(trimmed) || trimmed.length > 254) {
      setFieldError(t("refer.invalidEmail"));
      return;
    }
    setSubmitting(true);
    try {
      await onboardingApi.referToVndrly(trimmed);
      toast({
        title: t("refer.successTitle"),
        description: t("refer.successDescription", { email: trimmed }),
      });
      setEmail("");
      setOpen(false);
    } catch (err) {
      const description =
        err instanceof Error ? err.message : t("refer.failureDescription");
      setFieldError(`${t("refer.failureTitle")}: ${description}`);
      toast({
        title: t("refer.failureTitle"),
        description,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setFieldError("");
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent data-testid="refer-to-vndrly-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />
            {t("refer.title", { defaultValue: "Refer to VNDRLY" })}
          </DialogTitle>
          <DialogDescription>
            {t("refer.description", {
              defaultValue:
                "Send someone a link to start their own VNDRLY onboarding. They'll be able to choose vendor or partner.",
            })}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="refer-email">
              {t("refer.emailLabel", { defaultValue: "Recipient email" })}
            </Label>
            <Input
              id="refer-email"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("refer.emailPlaceholder", {
                defaultValue: "name@company.com",
              })}
              data-testid="input-refer-email"
              disabled={submitting}
            />
            {fieldError && (
              <p
                className="mt-1 text-sm text-destructive"
                data-testid="text-refer-error"
              >
                {fieldError}
              </p>
            )}
          </div>
          <div className="flex justify-end pt-2">
            <PngPillButton
              color="blue"
              type="submit"

              className="px-2"
              disabled={submitting}
              data-testid="button-refer-submit"
            >
              <Send className="w-4 h-4" />
              {submitting
                ? t("refer.sending", { defaultValue: "Sending…" })
                : t("refer.sendInvite", { defaultValue: "Send invite" })}
            </PngPillButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default ReferToVndrlyDialog;
