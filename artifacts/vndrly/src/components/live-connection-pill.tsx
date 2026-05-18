import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import PillBg from "@/components/pill-bg";
import amberPill from "@assets/900x229_Amber_Pill_v4_1778504507024.png";
import greenPill from "@assets/NewPillPallet_0001s_0051_900x229_green_Pill_v3.png";
import redPill from "@assets/900x229_red_Pill_v2_1777847855327.png";
import pillGloss from "@assets/900x229_overlay_v2_1777664185377.png";

const PILL_ASPECT = 900 / 229;

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
          "group relative inline-flex items-center justify-center select-none h-[23px]",
          minWidthClass,
          "bg-transparent border-0 p-0",
          coolingDown ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
        )}
      >
        <PillBg
          src={pillSrc}
          imageAspect={PILL_ASPECT}
          className="opacity-90 group-hover:opacity-100 transition-opacity"
        />
        <PillBg src={pillGloss} stretch className="opacity-60" />
        <span
          className="relative z-10 inline-flex items-center gap-1.5 px-2.5 text-xs font-bold text-white whitespace-nowrap"
          style={{ textShadow: "0 2px 4px rgba(0,0,0,0.9)" }}
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
        "group relative inline-flex items-center justify-center select-none align-middle pointer-events-none h-[23px]",
        compact ? "" : "min-w-[112px]",
      )}
    >
      <PillBg
        src={pillSrc}
        imageAspect={PILL_ASPECT}
        className="opacity-90 group-hover:opacity-100 transition-opacity"
      />
      <PillBg src={pillGloss} stretch className="opacity-60" />
      <span
        className="relative z-10 inline-flex items-center gap-1.5 px-2.5 text-xs font-bold text-white whitespace-nowrap"
        style={{ textShadow: "0 2px 4px rgba(0,0,0,0.9)" }}
        data-testid={`${testId}-label`}
      >
        {labels[status]}
      </span>
    </span>
  );
}

export default LiveConnectionPill;
