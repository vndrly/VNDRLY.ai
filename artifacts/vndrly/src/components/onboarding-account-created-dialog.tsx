import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { useTranslation } from "react-i18next";
import { CheckCircle2 } from "lucide-react";

interface OnboardingAccountCreatedDialogProps {
  open: boolean;
  orgType: "partner" | "vendor";
  companyName?: string;
  onContinue: () => void;
  onGoToDashboard: () => void;
}

export function OnboardingAccountCreatedDialog({
  open,
  orgType,
  companyName,
  onContinue,
  onGoToDashboard,
}: OnboardingAccountCreatedDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const orgLabel =
    orgType === "partner"
      ? t("onboardingWelcome.orgPartner")
      : t("onboardingWelcome.orgVendor");

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="dialog-account-created"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="text-center sm:text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2 className="h-7 w-7 text-green-600" />
          </div>
          <DialogTitle className="text-xl">
            {t("onboardingWelcome.title")}
          </DialogTitle>
          <DialogDescription className="text-base text-gray-600 pt-1">
            {companyName
              ? t("onboardingWelcome.subtitleNamed", { name: companyName, org: orgLabel })
              : t("onboardingWelcome.subtitle", { org: orgLabel })}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground text-center px-1">
          {t("onboardingWelcome.resumeHint")}
        </p>

        <div className="flex flex-col gap-2 pt-2">
          <PillButton
            color="green"
            className="w-full justify-center py-2.5 font-semibold"
            onClick={onContinue}
            data-testid="button-continue-onboarding"
          >
            {t("onboardingWelcome.continueOnboarding")}
          </PillButton>
          <PillButton
            color="blue"
            className="w-full justify-center py-2.5 font-semibold"
            onClick={onGoToDashboard}
            data-testid="button-go-to-dashboard"
          >
            {t("onboardingWelcome.goToDashboard")}
          </PillButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
