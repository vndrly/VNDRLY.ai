import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { LiveConnectionStatus } from "@/components/live-connection-pill";
import {
  flashFromVisitSseEvent,
  type GateLiveFlash,
  type GateLiveSseEvent,
  type KnownGateVisit,
} from "@/lib/gate-live-events";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const FLASH_HOLD_MS = 12_000;

export function useGateLiveMonitor(opts: {
  enabled: boolean;
  siteLocationId: number | null;
  gateStationId?:string;
  visits: KnownGateVisit[];
  queryKey: readonly unknown[];
}): {
  flash: GateLiveFlash | null;
  liveStatus: LiveConnectionStatus;
  dismissFlash: () => void;
} {
  const queryClient = useQueryClient();
  const [flash, setFlash] = useState<GateLiveFlash | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveConnectionStatus>("connecting");
  const visitsRef = useRef(opts.visits);
  const siteRef = useRef(opts.siteLocationId);
  const queryKeyRef = useRef(opts.queryKey);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  visitsRef.current = opts.visits;
  siteRef.current = opts.siteLocationId;
  queryKeyRef.current = opts.queryKey;

  const dismissFlash = () => {
    if (flashTimer.current) {
      clearTimeout(flashTimer.current);
      flashTimer.current = null;
    }
    setFlash(null);
  };

  useEffect(() => {
    setFlash(null);
    if (!opts.enabled || typeof EventSource === "undefined") {
      setLiveStatus("reconnecting");
      return;
    }
    setLiveStatus("connecting");
    const source = new EventSource(`${BASE}/api/visits/events${opts.gateStationId?`?gateStationId=${encodeURIComponent(opts.gateStationId)}`:""}`, { withCredentials: true });

    const holdFlash = (next: GateLiveFlash) => {
      setFlash(next);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => {
        flashTimer.current = null;
        setFlash(null);
      }, FLASH_HOLD_MS);
    };

    const onPayload = (raw: string) => {
      let parsed: GateLiveSseEvent;
      try {
        parsed = JSON.parse(raw) as GateLiveSseEvent;
      } catch {
        return;
      }
      const next = flashFromVisitSseEvent(parsed, {
        knownVisits: visitsRef.current,
        siteLocationId: siteRef.current,
      });
      void queryClient.invalidateQueries({ queryKey: [...queryKeyRef.current] });
      if (next) holdFlash(next);
    };

    source.onopen = () => setLiveStatus((prev) => (prev === "refreshed" ? prev : "live"));
    source.onerror = () => setLiveStatus("reconnecting");
    source.addEventListener("visit.hello", (evt: Event) => {
      try {
        const data = JSON.parse((evt as MessageEvent).data) as { gap?: boolean };
        if (data.gap) {
          setLiveStatus("refreshed");
          void queryClient.invalidateQueries({ queryKey: [...queryKeyRef.current] });
        }
      } catch {
        /* ignore malformed hello */
      }
    });
    source.addEventListener("visit.checked_in", (evt: Event) => {
      onPayload((evt as MessageEvent).data);
    });
    source.addEventListener("visit.checked_out", (evt: Event) => {
      onPayload((evt as MessageEvent).data);
    });

    return () => {
      source.close();
      if (flashTimer.current) {
        clearTimeout(flashTimer.current);
        flashTimer.current = null;
      }
    };
  }, [opts.enabled,opts.gateStationId, queryClient]);

  return { flash, liveStatus, dismissFlash };
}
