import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, Gauge, MapPin, Pause, Play } from "lucide-react";

export type TimelineTrackingPoint = {
  id?: number | string;
  latitude: number;
  longitude: number;
  recordedAt?: string | Date | null;
};

type Props = {
  tracking?: TimelineTrackingPoint[];
  selectedTrackingId?: number | string | null;
  onSelectTracking?: (id: number | string | null) => void;
  maxHeight?: number;
  longStopThresholdMs?: number;
  fastSegmentThresholdMph?: number;
};

function isValidLatLng(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

const SPEED_OPTIONS = [0.5, 1, 2, 4] as const;
type Speed = (typeof SPEED_OPTIONS)[number];
const BASE_INTERVAL_MS = 1000;
const DEFAULT_LONG_DWELL_MS = 5 * 60 * 1000;
// 90 mph is well above legal highway speeds in most U.S. states; treat it as
// "almost certainly noise or unrealistic" so reviewers can spot it quickly.
const DEFAULT_FAST_MPH = 90;
// Below this distance the segment is shorter than typical GPS jitter
// (~8 meters), so we don't compute a meaningful speed for it.
const MIN_SEGMENT_MILES = 0.005;

function distanceMiles(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles.
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) *
      Math.cos(toRad(b.latitude)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(sa));
}

function formatDistance(miles: number): string {
  if (!Number.isFinite(miles) || miles < 0) return "0 ft";
  if (miles < 0.1) {
    const ft = Math.round(miles * 5280);
    return `${ft} ft`;
  }
  if (miles < 10) return `${miles.toFixed(2)} mi`;
  return `${miles.toFixed(1)} mi`;
}

function formatSpeed(mph: number): string {
  if (!Number.isFinite(mph) || mph < 0) return "0 mph";
  if (mph < 10) return `${mph.toFixed(1)} mph`;
  return `${Math.round(mph)} mph`;
}

function formatDwell(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

export function TicketTrackingTimeline({
  tracking,
  selectedTrackingId,
  onSelectTracking,
  maxHeight = 360,
  longStopThresholdMs = DEFAULT_LONG_DWELL_MS,
  fastSegmentThresholdMph = DEFAULT_FAST_MPH,
}: Props) {
  const LONG_DWELL_MS = longStopThresholdMs;
  const FAST_MPH = fastSegmentThresholdMph;
  const sorted = useMemo(() => {
    if (!tracking || tracking.length === 0) return [];
    return tracking
      .filter((p) => isValidLatLng(p.latitude, p.longitude))
      .slice()
      .sort((a, b) => {
        const at = a.recordedAt ? new Date(a.recordedAt).getTime() : 0;
        const bt = b.recordedAt ? new Date(b.recordedAt).getTime() : 0;
        return at - bt;
      });
  }, [tracking]);

  // Per-point dwell time (ms since previous point). Index 0 is null.
  const dwellMs = useMemo(() => {
    return sorted.map((p, i) => {
      if (i === 0) return null;
      const prev = sorted[i - 1];
      const t = p.recordedAt ? new Date(p.recordedAt).getTime() : NaN;
      const pt = prev.recordedAt ? new Date(prev.recordedAt).getTime() : NaN;
      if (!Number.isFinite(t) || !Number.isFinite(pt)) return null;
      const diff = t - pt;
      return diff >= 0 ? diff : null;
    });
  }, [sorted]);

  // Per-point segment stats: distance from previous point (miles) and
  // average speed since previous point (mph). Index 0 is null. Speed is
  // null when the time gap is unknown / zero, or when the segment is
  // shorter than typical GPS jitter (in which case displaying a speed is
  // misleading).
  const segments = useMemo(() => {
    return sorted.map((p, i) => {
      if (i === 0) return null;
      const prev = sorted[i - 1];
      const miles = distanceMiles(prev, p);
      const ms = dwellMs[i];
      let mph: number | null = null;
      if (ms != null && ms > 0 && miles >= MIN_SEGMENT_MILES) {
        mph = miles / (ms / 3_600_000);
      }
      return { miles, mph };
    });
  }, [sorted, dwellMs]);

  const selectedIndex = useMemo(() => {
    if (selectedTrackingId == null) return -1;
    return sorted.findIndex((p) => p.id != null && p.id === selectedTrackingId);
  }, [sorted, selectedTrackingId]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const scrubberRef = useRef<HTMLInputElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number>(0);

  // Stop playback when the underlying tracking list changes meaningfully.
  useEffect(() => {
    setIsPlaying(false);
  }, [sorted.length]);

  // Stop at the end.
  useEffect(() => {
    if (!isPlaying) return;
    if (sorted.length === 0) {
      setIsPlaying(false);
      return;
    }
    if (selectedIndex >= sorted.length - 1) {
      setIsPlaying(false);
    }
  }, [isPlaying, selectedIndex, sorted.length]);

  // Playback timer.
  useEffect(() => {
    if (!isPlaying || sorted.length === 0 || !onSelectTracking) return;
    const interval = Math.max(80, Math.round(BASE_INTERVAL_MS / speed));
    const handle = window.setInterval(() => {
      const nextIndex = selectedIndex < 0 ? 0 : selectedIndex + 1;
      if (nextIndex >= sorted.length) {
        setIsPlaying(false);
        return;
      }
      const next = sorted[nextIndex];
      if (next?.id != null) {
        onSelectTracking(next.id);
      }
    }, interval);
    return () => window.clearInterval(handle);
  }, [isPlaying, speed, selectedIndex, sorted, onSelectTracking]);

  // Auto-scroll the selected item into view.
  useEffect(() => {
    if (selectedIndex < 0) return;
    const el = itemRefs.current[selectedIndex];
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedIndex]);

  if (sorted.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded border border-border bg-muted/40 text-xs text-muted-foreground p-3"
        style={{ minHeight: 80 }}
        data-testid="tracking-timeline-empty"
      >
        No tracking points recorded.
      </div>
    );
  }

  const handleSelect = (id: number | string | undefined) => {
    if (!onSelectTracking || id == null) return;
    onSelectTracking(id);
  };

  const handleClear = () => {
    setIsPlaying(false);
    onSelectTracking?.(null);
  };

  const handlePlayPause = () => {
    if (!onSelectTracking) return;
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (selectedIndex < 0 || selectedIndex >= sorted.length - 1) {
      const first = sorted[0];
      if (first?.id != null) onSelectTracking(first.id);
    }
    setIsPlaying(true);
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = Number(e.target.value);
    if (!Number.isFinite(idx)) return;
    const point = sorted[idx];
    if (point?.id != null) {
      onSelectTracking?.(point.id);
    }
  };

  const handleSpeedChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = Number(e.target.value) as Speed;
    if (SPEED_OPTIONS.includes(value)) setSpeed(value);
  };

  const handleScrubberMove = (e: React.MouseEvent<HTMLInputElement>) => {
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const maxIdx = Math.max(0, sorted.length - 1);
    const idx = Math.round(ratio * maxIdx);
    setHoverIndex(idx);
    setHoverX(e.clientX - rect.left);
  };

  const handleScrubberLeave = () => {
    setHoverIndex(null);
  };

  const scrubValue = selectedIndex < 0 ? 0 : selectedIndex;
  const canPlay = !!onSelectTracking && sorted.length > 0;
  const maxIndex = Math.max(0, sorted.length - 1);

  // Indices of points that represent a long dwell (gap from previous > threshold).
  const longDwellIndices = dwellMs
    .map((ms, i) => (ms != null && ms >= LONG_DWELL_MS ? i : -1))
    .filter((i) => i > 0);

  const hoveredPoint = hoverIndex != null ? sorted[hoverIndex] : null;
  const hoveredRecorded = hoveredPoint?.recordedAt
    ? new Date(hoveredPoint.recordedAt)
    : null;
  const hoveredDwell = hoverIndex != null ? dwellMs[hoverIndex] : null;

  return (
    <div className="rounded border border-border bg-card" data-testid="tracking-timeline">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Tracking timeline
        </div>
        <div className="flex items-center gap-2">
          {selectedTrackingId != null && onSelectTracking && (
            <button
              type="button"
              onClick={handleClear}
              className="text-xs hover:underline"
              style={{ color: "var(--brand-primary)" }}
              data-testid="tracking-timeline-clear"
            >
              Clear
            </button>
          )}
          <span className="text-xs text-muted-foreground">
            {sorted.length} point{sorted.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      {canPlay && (
        <div
          className="px-3 py-2 border-b border-border flex items-center gap-2"
          data-testid="tracking-timeline-playback"
        >
          <button
            type="button"
            onClick={handlePlayPause}
            className="inline-flex items-center justify-center w-7 h-7 rounded-full text-white hover:brightness-110 transition shrink-0"
            style={{ backgroundColor: "var(--brand-primary)" }}
            aria-label={isPlaying ? "Pause playback" : "Play playback"}
            aria-pressed={isPlaying}
            data-testid="tracking-timeline-play"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-[1px]" />}
          </button>
          <div className="relative flex-1">
            <input
              ref={scrubberRef}
              type="range"
              min={0}
              max={maxIndex}
              step={1}
              value={scrubValue}
              onChange={handleScrub}
              onMouseMove={handleScrubberMove}
              onMouseLeave={handleScrubberLeave}
              aria-label="Timeline scrubber"
              className="w-full cursor-pointer relative z-10"
              style={{ accentColor: "var(--brand-primary)" }}
              data-testid="tracking-timeline-scrubber"
            />
            {/* Long-dwell tick marks overlay */}
            {maxIndex > 0 && longDwellIndices.length > 0 && (
              <div
                className="pointer-events-none absolute left-0 right-0 top-1/2 -translate-y-1/2 h-3"
                aria-hidden="true"
                data-testid="tracking-timeline-dwell-ticks"
              >
                {longDwellIndices.map((i) => {
                  const pct = (i / maxIndex) * 100;
                  const ms = dwellMs[i] ?? 0;
                  return (
                    <span
                      key={i}
                      className="absolute top-0 bottom-0 w-[3px] -translate-x-1/2 rounded-sm bg-orange-500/80 ring-1 ring-orange-300"
                      style={{ left: `${pct}%` }}
                      title={`Long stop: ${formatDwell(ms)} before point ${i + 1}`}
                      data-testid={`tracking-timeline-dwell-tick-${i}`}
                    />
                  );
                })}
              </div>
            )}
            {hoverIndex != null && hoveredPoint && (
              <div
                className="pointer-events-none absolute -top-9 z-20 px-2 py-1 rounded bg-popover text-popover-foreground text-[11px] border border-border shadow-sm whitespace-nowrap -translate-x-1/2"
                style={{ left: `${hoverX}px` }}
                data-testid="tracking-timeline-scrubber-tooltip"
              >
                <span className="font-semibold">Point {hoverIndex + 1}</span>
                {hoveredRecorded && (
                  <span className="ml-1 text-muted-foreground">
                    {hoveredRecorded.toLocaleTimeString()}
                  </span>
                )}
                {hoveredDwell != null && hoveredDwell >= LONG_DWELL_MS && (
                  <span className="ml-1 text-orange-600 font-medium">
                    +{formatDwell(hoveredDwell)}
                  </span>
                )}
              </div>
            )}
          </div>
          <span
            className="text-[11px] tabular-nums text-muted-foreground w-12 text-right"
            data-testid="tracking-timeline-position"
          >
            {selectedIndex < 0 ? "—" : `${selectedIndex + 1}`}/{sorted.length}
          </span>
          <select
            value={speed}
            onChange={handleSpeedChange}
            aria-label="Playback speed"
            className="text-[11px] border border-border rounded px-1 py-0.5 bg-background"
            data-testid="tracking-timeline-speed"
          >
            {SPEED_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
        </div>
      )}
      <ul
        className="overflow-y-auto divide-y divide-border"
        style={{ maxHeight }}
        data-testid="tracking-timeline-list"
      >
        {sorted.map((p, i) => {
          const isSelected = p.id != null && p.id === selectedTrackingId;
          const recorded = p.recordedAt ? new Date(p.recordedAt) : null;
          const dwell = dwellMs[i];
          const isLongDwell = dwell != null && dwell >= LONG_DWELL_MS;
          const segment = segments[i];
          const isFastSegment =
            segment?.mph != null && segment.mph >= FAST_MPH;
          return (
            <li
              key={p.id ?? `${p.latitude}-${p.longitude}-${i}`}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
            >
              <button
                type="button"
                onClick={() => handleSelect(p.id)}
                onMouseEnter={() => {
                  if (isPlaying) return;
                  if (p.id != null) onSelectTracking?.(p.id);
                }}
                onFocus={() => {
                  if (isPlaying) return;
                  if (p.id != null) onSelectTracking?.(p.id);
                }}
                className={`w-full text-left px-3 py-2 flex items-start gap-2 transition-colors ${
                  isSelected
                    ? "border-l-2"
                    : isLongDwell
                      ? "bg-orange-500/5 hover:bg-orange-500/10 border-l-2 border-orange-400"
                      : "hover:bg-muted/60 border-l-2 border-transparent"
                }`}
                style={
                  isSelected
                    ? {
                        // Use color-mix so the brand color tints the
                        // background at 15% — same visual weight the old
                        // `bg-amber-500/15` had, but driven by brand.
                        backgroundColor:
                          "color-mix(in srgb, var(--brand-primary) 15%, transparent)",
                        borderLeftColor: "var(--brand-primary)",
                      }
                    : undefined
                }
                data-testid={`tracking-timeline-item-${i}`}
                aria-pressed={isSelected}
              >
                <MapPin
                  className={`w-4 h-4 mt-0.5 shrink-0 ${
                    isSelected
                      ? ""
                      : isLongDwell
                        ? "text-orange-500"
                        : "text-blue-500"
                  }`}
                  style={isSelected ? { color: "var(--brand-primary)" } : undefined}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs font-semibold">Point {i + 1}</p>
                    {recorded && (
                      <p className="text-[11px] text-muted-foreground whitespace-nowrap">
                        {recorded.toLocaleTimeString()}
                      </p>
                    )}
                  </div>
                  {recorded && (
                    <p className="text-[11px] text-muted-foreground">
                      {recorded.toLocaleDateString()}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground truncate">
                    {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
                  </p>
                  {dwell != null && (
                    <p
                      className={`mt-1 inline-flex items-center gap-1 text-[11px] ${
                        isLongDwell
                          ? "text-orange-600 font-semibold"
                          : "text-muted-foreground"
                      }`}
                      data-testid={`tracking-timeline-dwell-${i}`}
                    >
                      <Clock className="w-3 h-3" />
                      {isLongDwell ? "Stopped " : "+"}
                      {formatDwell(dwell)}
                      {isLongDwell && " since previous"}
                    </p>
                  )}
                  {segment && (
                    <p
                      className={`mt-0.5 inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] ${
                        isFastSegment
                          ? "text-red-600 font-semibold"
                          : "text-muted-foreground"
                      }`}
                      data-testid={`tracking-timeline-segment-${i}`}
                    >
                      <span
                        className="inline-flex items-center gap-1"
                        data-testid={`tracking-timeline-distance-${i}`}
                      >
                        <MapPin className="w-3 h-3" />
                        {formatDistance(segment.miles)}
                      </span>
                      {segment.mph != null && (
                        <span
                          className="inline-flex items-center gap-1"
                          data-testid={`tracking-timeline-speed-${i}`}
                        >
                          <Gauge className="w-3 h-3" />
                          {formatSpeed(segment.mph)}
                          {isFastSegment && (
                            <span className="ml-0.5 uppercase tracking-wide text-[10px]">
                              fast
                            </span>
                          )}
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
