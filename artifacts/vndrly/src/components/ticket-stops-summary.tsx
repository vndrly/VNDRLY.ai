import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Clock, MapPin } from "lucide-react";
import type { TimelineTrackingPoint } from "./ticket-tracking-timeline";
import {
  type DerivedStop,
  LONG_DWELL_MS as DEFAULT_LONG_DWELL_MS,
  deriveLongStops,
  formatDwell,
} from "@/lib/stops";

type Props = {
  tracking?: TimelineTrackingPoint[];
  selectedTrackingId?: number | string | null;
  onSelectTracking?: (id: number | string | null) => void;
  longStopThresholdMs?: number;
};

function formatThresholdMinutes(ms: number): string {
  const minutes = Math.round(ms / 60000);
  return `${minutes} min`;
}

type Stop = DerivedStop;

export function TicketStopsSummary({
  tracking,
  selectedTrackingId,
  onSelectTracking,
  longStopThresholdMs = DEFAULT_LONG_DWELL_MS,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const threshold = longStopThresholdMs;

  const stops = useMemo<Stop[]>(
    () => deriveLongStops(tracking, threshold),
    [tracking, threshold],
  );

  const handleSelect = (stop: Stop) => {
    const id = stop.endPoint.id;
    if (id != null) onSelectTracking?.(id);
  };

  return (
    <div
      className="rounded border border-border bg-card"
      data-testid="tracking-stops-summary"
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full px-3 py-2 border-b border-border flex items-center justify-between gap-2 hover:bg-muted/40 transition-colors"
        aria-expanded={!collapsed}
        data-testid="tracking-stops-summary-toggle"
      >
        <div className="flex items-center gap-2">
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          )}
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Stops
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {stops.length} stop{stops.length === 1 ? "" : "s"} · ≥ {formatThresholdMinutes(threshold)}
        </span>
      </button>
      {!collapsed && (
        <>
          {stops.length === 0 ? (
            <div
              className="px-3 py-3 text-xs text-muted-foreground text-center"
              data-testid="tracking-stops-summary-empty"
            >
              No long stops (≥ {formatThresholdMinutes(threshold)}) recorded.
            </div>
          ) : (
            <ul
              className="divide-y divide-border max-h-48 overflow-y-auto"
              data-testid="tracking-stops-summary-list"
            >
              {stops.map((stop, i) => {
                const isSelected =
                  stop.endPoint.id != null &&
                  stop.endPoint.id === selectedTrackingId;
                return (
                  <li key={stop.endPoint.id ?? `stop-${i}`}>
                    <button
                      type="button"
                      onClick={() => handleSelect(stop)}
                      className={`w-full text-left px-3 py-2 flex items-start gap-2 transition-colors ${
                        isSelected
                          ? "border-l-2"
                          : "hover:bg-orange-500/10 border-l-2 border-orange-400 bg-orange-500/5"
                      }`}
                      style={
                        isSelected
                          ? {
                              backgroundColor:
                                "color-mix(in srgb, var(--brand-primary) 15%, transparent)",
                              borderLeftColor: "var(--brand-primary)",
                            }
                          : undefined
                      }
                      data-testid={`tracking-stops-summary-item-${i}`}
                      aria-pressed={isSelected}
                    >
                      <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-orange-500" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-xs font-semibold">
                            Stop {i + 1}
                          </p>
                          {stop.startTime && (
                            <p className="text-[11px] text-muted-foreground whitespace-nowrap">
                              {stop.startTime.toLocaleTimeString()}
                            </p>
                          )}
                        </div>
                        <p
                          className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-orange-600 font-semibold"
                          data-testid={`tracking-stops-summary-duration-${i}`}
                        >
                          <Clock className="w-3 h-3" />
                          {formatDwell(stop.durationMs)}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {stop.startPoint.latitude.toFixed(5)},{" "}
                          {stop.startPoint.longitude.toFixed(5)}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
