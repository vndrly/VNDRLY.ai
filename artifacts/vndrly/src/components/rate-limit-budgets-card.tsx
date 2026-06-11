import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CARD_INNER_TILE_CLASS, CARD_TITLE_ICON_CLASS } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Gauge, Database, MemoryStick } from "lucide-react";
import { useBrand } from "@/hooks/use-brand";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface RoleBudget {
  role: string;
  max: number;
  windowMs: number;
  overridden: boolean;
}
interface EndpointBudgets {
  key: string;
  label: string;
  description: string;
  routes: string[];
  default: { max: number; windowMs: number };
  roles: RoleBudget[];
  envVarHint: { max: string; windowMs: string };
}
interface ResolvedStoreInfo {
  kind: "memory" | "redis";
  prefix: string | null;
}
interface RateLimitBudgetsResponse {
  endpoints: EndpointBudgets[];
  store?: ResolvedStoreInfo;
}

/**
 * Admin-only readout of the resolved rate-limit budget per session
 * role for every per-role rate-limited endpoint family in the API
 * (Task #697 extends Task #688's tickets-only readout to a
 * multi-endpoint listing). Mounted on the operations dashboard for
 * `user.role === "admin"` only. Fetches the read-only
 * `/api/admin/rate-limit-budgets` endpoint, which is itself
 * admin-gated, so a misplaced render still 403s instead of leaking
 * config.
 *
 * The card lets an operator confirm that env-var overrides like
 * `TICKETS_RATE_LIMIT_MAX_VENDOR=50` or
 * `LOCATIONS_RATE_LIMIT_MAX_DISPATCHER=120` actually took effect
 * after a restart, without grepping logs or having to trip a 429
 * in the wild.
 */
export function RateLimitBudgetsCard() {
  const brand = useBrand();
  const accentColor = brand.isOrgBranded ? brand.primary : "#f59e0b";
  const iconStyle = { color: accentColor };
  const [data, setData] = useState<RateLimitBudgetsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/admin/rate-limit-budgets`, {
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as RateLimitBudgetsResponse;
      })
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e?.message ?? e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card data-testid="card-rate-limit-budgets">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Gauge className={CARD_TITLE_ICON_CLASS} style={iconStyle} />
          API rate-limit budgets
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : error ? (
          <p className="text-sm text-muted-foreground">
            Couldn't load budgets: {error}
          </p>
        ) : data && data.endpoints.length > 0 ? (
          <div className="space-y-6">
            {data.store && <BackingStoreNote store={data.store} />}
            {data.endpoints.map((endpoint) => (
              <EndpointSection key={endpoint.key} endpoint={endpoint} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No rate-limited endpoints registered.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function BackingStoreNote({ store }: { store: ResolvedStoreInfo }) {
  // Task #776 — surface which BucketStore backend the limiters
  // resolved to. With `kind === "memory"` the budgets below are
  // enforced PER REPLICA, which is the diagnostic an operator
  // wants when a cap "feels higher than configured" on a scaled-out
  // deploy. With `kind === "redis"` the prefix tells them the key
  // namespace to inspect with `redis-cli SCAN`.
  const isRedis = store.kind === "redis";
  const Icon = isRedis ? Database : MemoryStick;
  return (
    <div
      className={cn(CARD_INNER_TILE_CLASS, "flex items-start gap-2 p-2")}
      data-testid="rate-limit-backing-store"
    >
      <Icon className="w-4 h-4 mt-0.5 text-muted-foreground" />
      <div className="text-xs text-muted-foreground leading-relaxed">
        <span className="font-medium text-foreground">Backing store:</span>{" "}
        <Badge
          variant={isRedis ? "default" : "secondary"}
          className="text-[10px] uppercase tracking-wide"
          data-testid="badge-rate-limit-store-kind"
        >
          {store.kind}
        </Badge>
        {isRedis && store.prefix && (
          <>
            {" "}
            key prefix{" "}
            <code
              className="px-1 py-0.5 rounded bg-muted text-[11px]"
              data-testid="text-rate-limit-store-prefix"
            >
              {store.prefix}
            </code>
          </>
        )}
        <div className="mt-1">
          {isRedis
            ? "Counters are shared across API replicas via Redis."
            : "Counters live in process memory — each API replica enforces its own copy of the caps below."}
        </div>
      </div>
    </div>
  );
}

function EndpointSection({ endpoint }: { endpoint: EndpointBudgets }) {
  return (
    <section
      className="space-y-2"
      data-testid={`section-rate-limit-${endpoint.key}`}
    >
      <header className="space-y-1">
        <h3
          className="text-sm font-semibold"
          data-testid={`text-rate-limit-endpoint-label-${endpoint.key}`}
        >
          {endpoint.label}
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {endpoint.description}
        </p>
        {endpoint.routes.length > 0 && (
          <p
            className="text-[11px] text-muted-foreground"
            data-testid={`text-rate-limit-routes-${endpoint.key}`}
          >
            {endpoint.routes.map((r, i) => (
              <span key={r}>
                <code className="px-1 py-0.5 rounded bg-muted text-[11px]">
                  {r}
                </code>
                {i < endpoint.routes.length - 1 ? " · " : ""}
              </span>
            ))}
          </p>
        )}
      </header>
      <div className="overflow-x-auto">
        <table
          className="w-full text-sm"
          data-testid={`table-rate-limit-${endpoint.key}`}
        >
          <thead>
            <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide">
              <th className="py-2 pr-4 font-medium">Role</th>
              <th className="py-2 pr-4 font-medium">Max requests</th>
              <th className="py-2 pr-4 font-medium">Window</th>
              <th className="py-2 pr-4 font-medium">Effective rate</th>
            </tr>
          </thead>
          <tbody>
            <BudgetRow
              endpointKey={endpoint.key}
              label="Unauthenticated / default"
              role="default"
              max={endpoint.default.max}
              windowMs={endpoint.default.windowMs}
            />
            {endpoint.roles.map((r) => (
              <BudgetRow
                key={r.role}
                endpointKey={endpoint.key}
                role={r.role}
                label={formatRoleLabel(r.role)}
                max={r.max}
                windowMs={r.windowMs}
                overridden={r.overridden}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Override per role with{" "}
        <code className="px-1 py-0.5 rounded bg-muted text-[11px]">
          {endpoint.envVarHint.max}
        </code>{" "}
        and{" "}
        <code className="px-1 py-0.5 rounded bg-muted text-[11px]">
          {endpoint.envVarHint.windowMs}
        </code>
        , then restart the API server. Roles without overrides inherit the
        default budget shown on the first row.
      </p>
    </section>
  );
}

function BudgetRow({
  endpointKey,
  role,
  label,
  max,
  windowMs,
  overridden = false,
}: {
  endpointKey: string;
  role: string;
  label: string;
  max: number;
  windowMs: number;
  overridden?: boolean;
}) {
  const seconds = windowMs / 1000;
  const ratePerSec = max / Math.max(0.001, seconds);
  return (
    <tr
      className="border-t border-border"
      data-testid={`row-rate-limit-${endpointKey}-${role}`}
    >
      <td className="py-2 pr-4">
        <div className="flex items-center gap-2">
          <span
            className="font-medium"
            data-testid={`text-rate-limit-role-${endpointKey}-${role}`}
          >
            {label}
          </span>
          {overridden && (
            <Badge
              variant="outline"
              className="text-[10px] uppercase tracking-wide"
              data-testid={`badge-overridden-${endpointKey}-${role}`}
            >
              overridden
            </Badge>
          )}
        </div>
      </td>
      <td
        className="py-2 pr-4 tabular-nums"
        data-testid={`text-rate-limit-max-${endpointKey}-${role}`}
      >
        {max.toLocaleString()}
      </td>
      <td
        className="py-2 pr-4 tabular-nums"
        data-testid={`text-rate-limit-window-${endpointKey}-${role}`}
      >
        {formatWindow(windowMs)}
      </td>
      <td className="py-2 pr-4 tabular-nums text-muted-foreground">
        ≈ {ratePerSec >= 10 ? ratePerSec.toFixed(0) : ratePerSec.toFixed(1)} req/s
      </td>
    </tr>
  );
}

function formatWindow(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) {
    return seconds === Math.round(seconds)
      ? `${seconds.toFixed(0)} s`
      : `${seconds.toFixed(1)} s`;
  }
  const minutes = seconds / 60;
  return minutes === Math.round(minutes)
    ? `${minutes.toFixed(0)} min`
    : `${minutes.toFixed(1)} min`;
}

function formatRoleLabel(role: string): string {
  // Convert snake_case role identifiers into a friendly label
  // ("field_employee" → "Field employee") so the readout reads the
  // same as the rest of the operations dashboard.
  if (!role) return role;
  return role
    .split("_")
    .map((part, i) =>
      i === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part,
    )
    .join(" ");
}
