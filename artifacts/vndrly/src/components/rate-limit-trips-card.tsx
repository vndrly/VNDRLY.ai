import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CARD_INNER_TILE_CLASS, CARD_TITLE_ICON_CLASS } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Activity, AlertTriangle } from "lucide-react";
import { useBrand } from "@/hooks/use-brand";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface TripRoleRow {
  role: string;
  trips: number;
  uniqueKeys: number;
}
interface TripWindow {
  key: string;
  windowMs: number;
  totalTrips: number;
  uniqueKeys: number;
  byRole: TripRoleRow[];
}
interface TripsBufferInfo {
  size: number;
  capacity: number;
  retentionMs: number;
  oldestTrackedAt: string | null;
}
interface TripsResponse {
  generatedAt: string;
  windows: TripWindow[];
  buffer: TripsBufferInfo;
  note: string;
}

const WINDOW_LABELS: Record<string, string> = {
  lastHour: "Last 60 minutes",
  last24Hours: "Last 24 hours",
};

/**
 * Admin-only readout of recent 429 rate-limit trips on the
 * `/api/tickets` endpoints (Task #696). Companion to the budgets
 * card: budgets confirm an override took effect; this confirms
 * whether the cap is actually being hit in the wild.
 *
 * Data comes from `/api/admin/tickets-rate-limit-trips`, which
 * reads the in-process ring buffer kept by the same tickets
 * limiter that `getTicketsBudgetForRole` reports — so the
 * displayed counts can never disagree with the budgets card on
 * which roles exist.
 *
 * Polls on a slow cadence (the buffer is in-process and
 * eventually consistent across replicas) and renders a small
 * notice when the buffer is at capacity, since older trips
 * could have been evicted.
 */
export function RateLimitTripsCard() {
  const brand = useBrand();
  const accentColor = brand.isOrgBranded ? brand.primary : "#f59e0b";
  const iconStyle = { color: accentColor };
  const [data, setData] = useState<TripsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`${BASE}/api/admin/tickets-rate-limit-trips`, {
          credentials: "include",
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as TripsResponse;
        if (cancelled) return;
        setData(json);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(String((e as Error)?.message ?? e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    // Refresh on a calm 30-second cadence — the buffer ages out
    // entries on its own and the dashboard isn't a real-time
    // monitor, so we don't burn a request every few seconds.
    const id = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <Card data-testid="card-rate-limit-trips">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Activity className={CARD_TITLE_ICON_CLASS} style={iconStyle} />
          Tickets API rate-limit trips
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && !data ? (
          <Skeleton className="h-32 w-full" />
        ) : error && !data ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="text-rate-limit-trips-error"
          >
            Couldn't load trip counts: {error}
          </p>
        ) : data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.windows.map((w) => (
                <TripWindowSection key={w.key} window={w} />
              ))}
            </div>
            <BufferNotice buffer={data.buffer} />
            <p
              className="text-[11px] text-muted-foreground leading-relaxed"
              data-testid="text-rate-limit-trips-caption"
            >
              Counts are the 429s served by the tickets limiter on{" "}
              <code className="px-1 py-0.5 rounded bg-muted text-[11px]">
                GET /api/tickets
              </code>{" "}
              and{" "}
              <code className="px-1 py-0.5 rounded bg-muted text-[11px]">
                GET /api/tickets/:id
              </code>{" "}
              over the windows shown. <strong>Unique clients</strong>{" "}
              dedupes by signed-in session userId, falling back to client
              IP for unauthenticated requests, so one runaway tab counts
              as one client even after many trips. Trips are kept in an
              in-process ring buffer per replica and clear on restart;
              the durable record stays in the{" "}
              <code className="px-1 py-0.5 rounded bg-muted text-[11px]">
                tickets.rate_limit.trip
              </code>{" "}
              log line.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No trip data available.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function TripWindowSection({ window: w }: { window: TripWindow }) {
  const label = WINDOW_LABELS[w.key] ?? formatWindow(w.windowMs);
  const hasTrips = w.totalTrips > 0;
  return (
    <section
      className={cn(CARD_INNER_TILE_CLASS, "space-y-2")}
      data-testid={`section-rate-limit-trips-${w.key}`}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{label}</h3>
        <span
          className="text-2xl font-bold tabular-nums"
          data-testid={`text-rate-limit-trips-total-${w.key}`}
        >
          {w.totalTrips.toLocaleString()}
        </span>
      </header>
      <p
        className="text-xs text-muted-foreground"
        data-testid={`text-rate-limit-trips-unique-${w.key}`}
      >
        {w.totalTrips === 0
          ? "No trips recorded in this window."
          : `${w.uniqueKeys.toLocaleString()} unique ${
              w.uniqueKeys === 1 ? "client" : "clients"
            } across ${w.totalTrips.toLocaleString()} ${
              w.totalTrips === 1 ? "trip" : "trips"
            }.`}
      </p>
      {hasTrips && (
        <div className="overflow-x-auto">
          <table
            className="w-full text-sm"
            data-testid={`table-rate-limit-trips-${w.key}`}
          >
            <thead>
              <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide">
                <th className="py-1 pr-3 font-medium">Role</th>
                <th className="py-1 pr-3 font-medium tabular-nums text-right">
                  Trips
                </th>
                <th className="py-1 pr-3 font-medium tabular-nums text-right">
                  Unique clients
                </th>
              </tr>
            </thead>
            <tbody>
              {w.byRole.map((r) => (
                <tr
                  key={r.role}
                  className="border-t border-border"
                  data-testid={`row-rate-limit-trips-${w.key}-${r.role}`}
                >
                  <td
                    className="py-1 pr-3 font-medium"
                    data-testid={`text-rate-limit-trips-role-${w.key}-${r.role}`}
                  >
                    {formatRoleLabel(r.role)}
                  </td>
                  <td
                    className="py-1 pr-3 text-right tabular-nums"
                    data-testid={`text-rate-limit-trips-role-trips-${w.key}-${r.role}`}
                  >
                    {r.trips.toLocaleString()}
                  </td>
                  <td
                    className="py-1 pr-3 text-right tabular-nums"
                    data-testid={`text-rate-limit-trips-role-unique-${w.key}-${r.role}`}
                  >
                    {r.uniqueKeys.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function BufferNotice({ buffer }: { buffer: TripsBufferInfo }) {
  // The buffer is at capacity when `size === capacity`; once that
  // happens the oldest entries are getting evicted on every new
  // trip, which means the 24h window can under-count. Only render
  // the notice when we're actually saturated; otherwise the buffer
  // is just a sizing detail and we keep the panel quiet.
  if (buffer.size < buffer.capacity) return null;
  return (
    <div
      className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
      data-testid="rate-limit-trips-buffer-notice"
      role="status"
    >
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span>
        The in-process trips buffer is full ({buffer.size.toLocaleString()}{" "}
        of {buffer.capacity.toLocaleString()} entries). Older trips have
        been evicted, so totals may under-count.
      </span>
    </div>
  );
}

function formatWindow(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  const minutes = ms / 60_000;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) {
    return hours === Math.round(hours)
      ? `${hours.toFixed(0)} h`
      : `${hours.toFixed(1)} h`;
  }
  const days = hours / 24;
  return days === Math.round(days)
    ? `${days.toFixed(0)} d`
    : `${days.toFixed(1)} d`;
}

function formatRoleLabel(role: string): string {
  if (!role) return role;
  if (role === "unknown") return "Unknown / unauthenticated";
  return role
    .split("_")
    .map((part, i) =>
      i === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part,
    )
    .join(" ");
}
