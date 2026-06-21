import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { ShieldAlert } from "lucide-react";
import { useSafetyTrainingStatus } from "@/lib/safety-api";

export function SafetyTrainingBanner() {
  const { t } = useTranslation();
  const { data } = useSafetyTrainingStatus();

  if (!data || data.incompleteModules.length === 0) return null;

  return (
    <Link href="/safety-training">
      <div
        className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-amber-100/80 transition-colors"
        data-testid="banner-safety-training"
      >
        <ShieldAlert className="h-5 w-5 text-amber-700 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-amber-900">{t("safety.trainingBannerTitle")}</p>
          <p className="text-xs text-amber-800">{t("safety.trainingBannerTap")}</p>
        </div>
      </div>
    </Link>
  );
}
