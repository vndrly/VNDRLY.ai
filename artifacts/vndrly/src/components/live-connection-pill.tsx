import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { PillColorLayer, PillGlossOverlay } from "@/components/png-pill-chrome";
import amberPill from "@assets/900x229_Amber_Pill_v4_1778504507024.png";
import greenPill from "@assets/NewPillPallet_0001s_0051_900x229_green_Pill_v3.png";
import redPill from "@assets/900x229_red_Pill_v2_1777847855327.png";
import {
  PILL_HEIGHT_CLASS,
  PILL_HEIGHT_PX,
  PILL_LABEL_CLASS,
  PILL_TEXT_SHADOW,
  PILL_WRAPPER_CLASS,
} from "@/lib/pill-doctrine";

export type LiveConnectionStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "refreshed";

const STATUS_PILL: Record<LiveConnectionStatus, string> = {
  connecting: amberPill,
  live: greenPill,
  reconnecting: redPill,
  refreshed: greenPill,
};

export function LiveConnectionPill({
  status,
  onRefresh,
  refreshCooldownMs = 1500,
  testId = "live-connection-pill",
  compact = false,
}: {
  status: LiveConnectionStatus;
  compact?: boolean;
  onRefresh?: () => void;
  refreshCooldownMs?: number;
  testId?: string;
}) {
  const { t } = useTranslation();

  const cooldownActiveRef = useRef(false);
  const [coolingDown, setCoolingDown] = useState(false);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
    };
  }, []);

  const handleManualRefreshClick = useCallback(() => {
    if (cooldownActiveRef.current) return;
    if (typeof onRefresh !== "function") return;
    cooldownActiveRef.current = true;
    setCoolingDown(true);
    onRefresh();
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    cooldownTimerRef.current = setTimeout(() => {
      cooldownTimerRef.current = null;
      cooldownActiveRef.current = false;
      setCoolingDown(false);
    }, refreshCooldownMs);
  }, [onRefresh, refreshCooldownMs]);

  const labels: Record<LiveConnectionStatus, string> = {
    connecting: t("liveConnection.connecting", { defaultValue: "Connecting…" }),
    live: t("liveConnection.live", { defaultValue: "Live" }),
    reconnecting: t("liveConnection.reconnecting", { defaultValue: "Reconnecting…" }),
    refreshed: t("liveConnection.refreshed", { defaultValue: "Reconnected — refreshed" }),
  };

  const interactive = status === "reconnecting" && typeof onRefresh === "function";

  const refreshNowLabel = t("liveConnection.refreshNow", { defaultValue: "Refresh now" });
  const reconnectingActionLabel = t("liveConnection.reconnectingAction", {
    defaultValue: "Reconnecting — refresh now",
  });
  const reconnectingAriaLabel = t("liveConnection.reconnectingAriaLabel", {
    defaultValue: "Reconnecting. Click to refresh data now.",
  });
  const cooldownAriaLabel = t("liveConnection.refreshCooldownAriaLabel", {
    defaultValue:
      "Refreshing — please wait a moment before requesting another refresh.",
  });

  const pillSrc = STATUS_PILL[status];
  const minWidthClass = compact ? "" : "min-w-[126px]";

  if (interactive) {
    return (
      <button
        type="button"
        onClick={handleManualRefreshClick}
        disabled={coolingDown}
        aria-disabled={coolingDown ? "true" : undefined}
        aria-label={coolingDown ? cooldownAriaLabel : reconnectingAriaLabel}
        title={coolingDown ? cooldownAriaLabel : reconnectingAriaLabel}
        data-testid={testId}
        data-status={status}
        data-interactive="true"
        data-cooldown={coolingDown ? "true" : undefined}
        className={cn(
          PILL_WRAPPER_CLASS,
          PILL_HEIGHT_CLASS,
          minWidthClass,
          "bg-transparent border-0 p-0",
          coolingDown ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
        )}
        style={{ height: PILL_HEIGHT_PX }}
      >
        <PillColorLayer src={pillSrc} className="group-hover:opacity-100" />
        <PillGlossOverlay />
        <span
          className={cn(PILL_LABEL_CLASS, "h-full gap-1.5 text-white")}
          style={{ textShadow: PILL_TEXT_SHADOW }}
        >
          <RefreshCw
            aria-hidden="true"
            className={cn("h-3 w-3", coolingDown && "animate-spin")}
            data-testid={`${testId}-refresh-icon`}
          />
          <span aria-hidden="true" data-testid={`${testId}-label`}>
            {reconnectingActionLabel}
          </span>
          <span className="sr-only">{refreshNowLabel}</span>
        </span>
      </button>
    );
  }

  return (
    <span
      role="status"
      aria-live="polite"
      data-testid={testId}
      data-status={status}
      className={cn(
        PILL_WRAPPER_CLASS,
        PILL_HEIGHT_CLASS,
        "pointer-events-none",
        compact ? "" : "min-w-[112px]",
      )}
      style={{ height: PILL_HEIGHT_PX }}
    >
      <PillColorLayer src={pillSrc} />
      <PillGlossOverlay />
      <span
        className={cn(PILL_LABEL_CLASS, "h-full gap-1.5 text-white")}
        style={{ textShadow: PILL_TEXT_SHADOW }}
        data-testid={`${testId}-label`}
      >
        {labels[status]}
      </span>
    </span>
  );
}

export default LiveConnectionPill;
