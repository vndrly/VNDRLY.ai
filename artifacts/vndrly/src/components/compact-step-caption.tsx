import { useTranslation } from "react-i18next";

export function CompactStepCaption({ index, total, label, color, preview }: {
  index: number;
  total: number;
  label: string;
  color: string;
  preview: boolean;
}) {
  const { t } = useTranslation();
  return (
    <p className="mt-2 text-center text-xs font-bold @[460px]:hidden" style={{ color: preview ? "#fff" : color }}>
      {t("onboardingStepper.currentStep", { current: index + 1, total, label })}
    </p>
  );
}
