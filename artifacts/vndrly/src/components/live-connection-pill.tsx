import { useCallback, useEffect, useRef, useState } from "react";

import { RefreshCw } from "lucide-react";

import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

import StatusIndicator, { INDICATOR_COLORS, STATUS_INDICATOR_CLASS } from "@/components/status-indicator";

export type LiveConnectionStatus =

  | "connecting"

  | "live"

  | "reconnecting"

  | "refreshed";



export function LiveConnectionPill({

  status,

  onRefresh,

  refreshCooldownMs = 1500,

  testId = "live-connection-pill",


}: {

  status: LiveConnectionStatus;

  compact?: boolean;
  appearance?: "pill" | "indicator" | "subtle";

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



  const color = status === "reconnecting" ? "red" : status === "connecting" ? "amber" : "green";
  if (interactive) {
    return <button type="button" onClick={handleManualRefreshClick} disabled={coolingDown}
      aria-disabled={coolingDown ? "true" : undefined}
      aria-label={coolingDown ? cooldownAriaLabel : reconnectingAriaLabel}
      title={coolingDown ? cooldownAriaLabel : reconnectingAriaLabel}
      data-testid={testId} data-status={status} data-interactive="true"
      data-cooldown={coolingDown ? "true" : undefined}
      style={{ color: INDICATOR_COLORS[color] }}
      className={cn(STATUS_INDICATOR_CLASS, "border-0 disabled:opacity-60")}>
      <span aria-hidden="true" className="status-indicator-dot h-1.5 w-1.5 shrink-0 rounded-full !bg-current" />
      <span data-testid={`${testId}-label`}>{reconnectingActionLabel}</span>
      <RefreshCw aria-hidden="true" className={cn("h-3 w-3", coolingDown && "animate-spin")} data-testid={`${testId}-refresh-icon`} />
      <span className="sr-only">{refreshNowLabel}</span>
    </button>;
  }
  return <StatusIndicator color={color} aria-live="polite" data-testid={testId} data-status={status}>
    <span data-testid={`${testId}-label`}>{labels[status]}</span>
  </StatusIndicator>;
}
export default LiveConnectionPill;
