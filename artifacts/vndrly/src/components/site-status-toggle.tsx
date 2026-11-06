import "@/components/workday-controls.css";
import { useTranslation } from "react-i18next";
import WorkdayStatusSwitch from "@/components/workday-status-switch";

export default function SiteStatusToggle({
  active,
  onActiveClick,
  onInactiveClick,
  readOnly = false,
  disabled = false,
  className,
}: {
  active: boolean;
  onActiveClick?: () => void;
  onInactiveClick?: () => void;
  readOnly?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const toggle = active ? onInactiveClick : onActiveClick;

  return (
    <div className={className} data-testid="site-status-toggle">
      <WorkdayStatusSwitch
        active={active}
        label={t(active ? "siteLocations.statusOption.active" : "siteLocations.statusOption.inactive")}
        accessibilityLabel={t("siteLocations.statusLabel")}
        disabled={readOnly || disabled || !toggle}
        onClick={() => toggle?.()}
      />
    </div>
  );
}
