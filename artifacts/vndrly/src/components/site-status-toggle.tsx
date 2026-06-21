import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import SplitToggleHalf from "@/components/split-toggle-half";
import { TOGGLE_IDLE_PILL_SRC, splitToggleDividerClass } from "@/lib/pick-toggle-pill";
import { pillGreen, pillRed } from "@/lib/pill-palette-assets";

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
  const canInteract = !readOnly && !disabled;
  const dividerClass = splitToggleDividerClass("light");

  return (
    <div
      className={cn(
        "inline-flex items-stretch rounded-full overflow-hidden",
        (readOnly || disabled) && "opacity-80",
        className,
      )}
      data-testid="site-status-toggle"
    >
      <SplitToggleHalf
        side="left"
        active={active}
        pillSrc={active ? pillGreen : TOGGLE_IDLE_PILL_SRC}
        onClick={canInteract ? onActiveClick : undefined}
        disabled={!canInteract}
        data-testid="site-status-active"
        aria-pressed={active}
        aria-label={t("siteLocations.statusOption.active")}
      >
        {t("siteLocations.statusOption.active")}
      </SplitToggleHalf>
      <span aria-hidden className={cn("w-px shrink-0 self-stretch", dividerClass)} />
      <SplitToggleHalf
        side="right"
        active={!active}
        pillSrc={!active ? pillRed : TOGGLE_IDLE_PILL_SRC}
        onClick={canInteract ? onInactiveClick : undefined}
        disabled={!canInteract}
        data-testid="site-status-inactive"
        aria-pressed={!active}
        aria-label={t("siteLocations.statusOption.inactive")}
      >
        {t("siteLocations.statusOption.inactive")}
      </SplitToggleHalf>
    </div>
  );
}
