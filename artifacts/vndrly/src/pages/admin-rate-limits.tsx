// Admin operations dashboard for the per-resource rate-limit budgets
// (Task #709). Renders one card per limiter listed by
// `GET /api/admin/rate-limit-budgets`, with the resolved
// `{ default, roles[] }` shape, an "overridden" pill on each role
// row whose budget differs from the default, and the env-var hint
// the operator can use to tweak the budget.
//
// Why this page exists: after Tasks #689/#698 the API has eight
// per-resource limiters (tickets, dashboard, live-locations, visits,
// notifications, comments, participants, hotlist), each with its own
// `<PREFIX>_RATE_LIMIT_MAX[_<ROLE>]` and `_WINDOW_MS[_<ROLE>]`
// overrides. Before this page the only readout was the legacy
// tickets-only endpoint (since retired in Task #764), so an operator
// who set e.g. `VISITS_RATE_LIMIT_MAX_DISPATCHER=200` after a deploy
// had no way to confirm it took effect without grepping logs or
// tripping a 429 in the wild. This page gives them a single
// auditable surface.
//
// Values are read live from the server on each mount/refetch and the
// server itself reads env vars on every call, so an operator who
// rolls the process to apply an env override can hit "Refresh" here
// and see the new numbers without redeploying anything.

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCcw, Gauge, Database, MemoryStick } from "lucide-react";
import ContentPaneBackLink from "@/components/content-pane-back-link";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ResolvedRoleRow = {
  role: string;
  max: number;
  windowMs: number;
  overridden: boolean;
  // Optional for back-compat with older API replicas that haven't
  // shipped the recent-trips rollup yet (Task #763). When absent
  // the cell renders a "—" rather than a misleading "0×".
  recentTrips?: number;
};

type ResolvedEndpointBudgets = {
  key: string;
  label: string;
  description: string;
  routes: string[];
  default: { max: number; windowMs: number };
  roles: ResolvedRoleRow[];
  envVarHint: { max: string; windowMs: string };
  recentTripsWindowMs?: number;
  recentTripsUnknown?: number;
  recentTripsTotal?: number;
};

type ResolvedStoreInfo = {
  kind: "memory" | "redis";
  prefix: string | null;
};

type RateLimitBudgetsResponse = {
  endpoints: ResolvedEndpointBudgets[];
  store?: ResolvedStoreInfo;
};

// Render `windowMs` as a compact, operator-friendly duration. The
// limiter accepts arbitrary positive integers in env vars, so we
// have to handle very-short (sub-second) and multi-minute values
// without dropping precision.
function formatWindow(windowMs: number): string {
  if (windowMs < 1000) return `${windowMs} ms`;
  const seconds = windowMs / 1000;
  if (seconds < 60) {
    // Strip trailing ".0" so 10000 → "10 s", 1500 → "1.5 s".
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
  }
  const minutes = seconds / 60;
  return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} min`;
}

// Render the recent-trips window length as the operator-friendly
// "last N min" caption next to each card. Trip windows are coarser
// than the limiter windows (15 min default), so we don't need the
// sub-second / fractional handling `formatWindow` does.
function formatTripsWindow(windowMs: number): string {
  const minutes = windowMs / 60_000;
  if (minutes >= 1) {
    return `last ${
      Number.isInteger(minutes) ? minutes : minutes.toFixed(1)
    } min`;
  }
  const seconds = Math.max(1, Math.round(windowMs / 1000));
  return `last ${seconds} s`;
}

function formatRate(max: number, windowMs: number): string {
  const seconds = windowMs / 1000;
  if (seconds <= 0) return "—";
  const perSecond = max / seconds;
  if (perSecond >= 1) {
    return `≈ ${
      Number.isInteger(perSecond) ? perSecond : perSecond.toFixed(2)
    } req/s`;
  }
  // Sub-1-req/s: show per-minute so the rough cadence is still
  // legible (e.g. 30 req / 5 min → "≈ 6 req/min" instead of
  // "≈ 0.10 req/s").
  const perMinute = perSecond * 60;
  return `≈ ${
    Number.isInteger(perMinute) ? perMinute : perMinute.toFixed(2)
  } req/min`;
}

// Task #776 — surface which BucketStore backend the limiters
// resolved to alongside the per-endpoint budgets. With `kind ===
// "memory"` every budget shown below is enforced PER REPLICA, so
// an operator who's scaled the API horizontally can immediately
// tell why a cap "feels higher than configured" without grepping
// logs. With `kind === "redis"` the prefix tells them which key
// namespace to inspect with `redis-cli SCAN`.
function BackingStoreCard({ store }: { store: ResolvedStoreInfo }) {
  const isRedis = store.kind === "redis";
  const Icon = isRedis ? Database : MemoryStick;
  return (
    <Card data-testid="card-rate-limit-store">
      <CardContent className="p-4 flex flex-wrap items-start gap-4">
        <Icon className="w-5 h-5 text-muted-foreground mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">Backing store</span>
            <Badge
              variant={isRedis ? "default" : "secondary"}
              data-testid="badge-rate-limit-store-kind"
            >
              {store.kind}
            </Badge>
            {isRedis && store.prefix && (
              <code
                className="text-xs bg-muted px-1.5 py-0.5 rounded"
                data-testid="text-rate-limit-store-prefix"
              >
                {store.prefix}
              </code>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {isRedis
              ? "Counters are shared across replicas via Redis. The configured caps are enforced cluster-wide."
              : "Counters live in process memory. Each API replica enforces its own copy of the caps below — set RATE_LIMIT_REDIS_URL to share counters across replicas."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function EndpointCard({ endpoint }: { endpoint: ResolvedEndpointBudgets }) {
  const overriddenCount = endpoint.roles.filter((r) => r.overridden).length;
  // Recent-trips data is optional on the response (older API
  // replicas may not yet return it) — only render the trip pills
  // and column when the field is present, so a stale server
  // doesn't show a misleading "0×".
  const tripsAvailable = endpoint.recentTripsWindowMs !== undefined;
  const tripsWindowLabel = tripsAvailable
    ? formatTripsWindow(endpoint.recentTripsWindowMs!)
    : null;
  const totalTrips = endpoint.recentTripsTotal ?? 0;
  const unknownTrips = endpoint.recentTripsUnknown ?? 0;
  return (
    <Card data-testid={`card-rate-limit-${endpoint.key}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle
              className="text-lg"
              data-testid={`text-rate-limit-label-${endpoint.key}`}
            >
              {endpoint.label}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {endpoint.description}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {tripsAvailable && totalTrips > 0 && (
              <Badge
                variant="destructive"
                data-testid={`badge-trips-total-${endpoint.key}`}
              >
                tripped {totalTrips}× in the {tripsWindowLabel}
              </Badge>
            )}
            {overriddenCount > 0 && (
              <Badge
                variant="default"
                data-testid={`badge-overridden-count-${endpoint.key}`}
              >
                {overriddenCount} role{overriddenCount === 1 ? "" : "s"} overridden
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-4 text-sm">
          <div>
            <div className="text-xs uppercase text-muted-foreground">
              Default budget
            </div>
            <div
              className="font-mono"
              data-testid={`text-default-budget-${endpoint.key}`}
            >
              {endpoint.default.max} per {formatWindow(endpoint.default.windowMs)}
              <span className="text-muted-foreground ml-2">
                ({formatRate(endpoint.default.max, endpoint.default.windowMs)})
              </span>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">
              Env-var hint
            </div>
            <div className="font-mono text-xs">
              {endpoint.envVarHint.max}
              <br />
              {endpoint.envVarHint.windowMs}
            </div>
          </div>
        </div>

        <div>
          <div className="text-xs uppercase text-muted-foreground mb-1">
            Routes
          </div>
          <div className="flex flex-wrap gap-1">
            {endpoint.routes.map((route) => (
              <code
                key={route}
                className="text-xs bg-muted px-1.5 py-0.5 rounded"
              >
                {route}
              </code>
            ))}
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Max</TableHead>
              <TableHead className="text-right">Window</TableHead>
              <TableHead className="text-right">Effective rate</TableHead>
              {tripsAvailable && (
                <TableHead
                  className="text-right"
                  data-testid={`th-trips-${endpoint.key}`}
                >
                  Trips ({tripsWindowLabel})
                </TableHead>
              )}
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {endpoint.roles.map((row) => (
              <TableRow
                key={row.role}
                data-testid={`row-rate-limit-${endpoint.key}-${row.role}`}
              >
                <TableCell className="font-medium">{row.role}</TableCell>
                <TableCell
                  className="text-right font-mono"
                  data-testid={`cell-max-${endpoint.key}-${row.role}`}
                >
                  {row.max}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatWindow(row.windowMs)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {formatRate(row.max, row.windowMs)}
                </TableCell>
                {tripsAvailable && (
                  <TableCell
                    className={`text-right font-mono ${
                      (row.recentTrips ?? 0) > 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }`}
                    data-testid={`cell-recent-trips-${endpoint.key}-${row.role}`}
                  >
                    {row.recentTrips ?? 0}×
                  </TableCell>
                )}
                <TableCell className="text-right">
                  {row.overridden ? (
                    <Badge
                      variant="default"
                      data-testid={`badge-overridden-${endpoint.key}-${row.role}`}
                    >
                      Overridden
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      default
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {tripsAvailable && unknownTrips > 0 && (
          <p
            className="text-xs text-muted-foreground"
            data-testid={`text-trips-unknown-${endpoint.key}`}
          >
            Plus {unknownTrips}× from unauthenticated or unrecognized callers
            in the {tripsWindowLabel}; those inherit the default budget.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminRateLimits() {
  const { user } = useAuth();

  const isAdmin = user?.role === "admin";

  const { data, isLoading, isError, error, refetch, isFetching } =
    useQuery<RateLimitBudgetsResponse>({
      queryKey: ["admin", "rate-limit-budgets"],
      queryFn: async () => {
        const res = await fetch(`${API_BASE}/api/admin/rate-limit-budgets`, {
          credentials: "include",
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? "load_failed");
        }
        return res.json();
      },
      enabled: isAdmin,
    });

  if (!isAdmin) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Admin role required.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <ContentPaneBackLink href="/" />
          <Gauge className="w-6 h-6 text-muted-foreground" />
          <div>
            <h1
              className="text-2xl font-semibold"
              data-testid="text-rate-limits-title"
            >
              Rate-limit budgets
            </h1>
            <p className="text-sm text-muted-foreground">
              Per-resource throttle budgets resolved live from the API
              server. Override a row by setting the matching env var
              (see hint) and rolling the API process.
            </p>
          </div>
        </div>
        <PillButton
          color="image"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh-rate-limits"
        >
          <RefreshCcw
            className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </PillButton>
      </div>

      {isLoading && (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Failed to load rate-limit budgets:{" "}
            {error instanceof Error ? error.message : "unknown error"}
          </CardContent>
        </Card>
      )}

      {data?.store && <BackingStoreCard store={data.store} />}

      {data && data.endpoints.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No rate-limited endpoints are registered.
          </CardContent>
        </Card>
      )}

      {data && (
        <div
          className="grid gap-4"
          data-testid="list-rate-limit-endpoints"
        >
          {data.endpoints.map((endpoint) => (
            <EndpointCard key={endpoint.key} endpoint={endpoint} />
          ))}
        </div>
      )}
    </div>
  );
}
