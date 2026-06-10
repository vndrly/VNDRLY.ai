import { useCallback, useEffect, useRef, useState } from "react";

import { RefreshCw } from "lucide-react";

import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

import { PillColorLayer } from "@/components/png-pill-chrome";

import { pillAmber, pillGreen, pillRed } from "@/lib/pill-palette-assets";

import {

  PILL_HEIGHT_CLASS,

  PILL_HEIGHT_PX,

  PILL_LABEL_CLASS,

  PILL_WRAPPER_CLASS,

  pillLabelToneClass,

} from "@/lib/pill-doctrine";



export type LiveConnectionStatus =

  | "connecting"

  | "live"

  | "reconnecting"

  | "refreshed";



const STATUS_PILL: Record<LiveConnectionStatus, string> = {

  connecting: pillAmber,

  live: pillGreen,

  reconnecting: pillRed,

  refreshed: pillGreen,

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

          "border-0 bg-transparent p-0",

          coolingDown ? "cursor-not-allowed opacity-60" : "cursor-pointer",

        )}

        style={{ height: PILL_HEIGHT_PX }}

      >

        <PillColorLayer src={pillSrc} />

        <span className={cn(PILL_LABEL_CLASS, "h-full gap-1.5", pillLabelToneClass(false))}>

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

      <span

        className={cn(PILL_LABEL_CLASS, "h-full gap-1.5", pillLabelToneClass(false))}

        data-testid={`${testId}-label`}

      >

        {labels[status]}

      </span>

    </span>

  );

}



export default LiveConnectionPill;

