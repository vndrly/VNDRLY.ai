import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, MessageSquare, AlertOctagon, Zap, CheckCircle2, ShieldAlert } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface DayBucket {
  day: string;
  count: number;
}
interface SignupAssistantUsage {
  dayKey: string;
  todayUsed: number;
  todayBudget: number;
  activeIpBuckets: number;
  ipMax: number;
  ipWindowMs: number;
}
interface AssistantMetrics {
  rangeDays: number;
  since: string;
  sessionsByDay: DayBucket[];
  messagesByDay: DayBucket[];
  refusalCount: number;
  ttftMs: { avg: number | null; p95: number | null; sample: number };
  completedOnboardingByOrg: { orgType: string; count: number }[];
  signupAssistant?: SignupAssistantUsage;
}

/**
 * Small admin-only roll-up of "Ask VNDRLY" usage. Mounted on the
 * dashboard for `user.role === "admin"` only. Fetches the read-only
 * `/api/assistant/metrics` endpoint, which is itself admin-gated, so
 * a misplaced render still 403s instead of leaking data.
 */
export function AssistantMetricsCard() {
  const [data, setData] = useState<AssistantMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/assistant/metrics?days=7`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as AssistantMetrics;
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

  const totalSessions = data?.sessionsByDay.reduce((s, d) => s + d.count, 0) ?? 0;
  const totalMessages = data?.messagesByDay.reduce((s, d) => s + d.count, 0) ?? 0;
  const refusalRate =
    totalMessages > 0 && data ? Math.round((data.refusalCount / totalMessages) * 1000) / 10 : 0;
  const completedTotal =
    data?.completedOnboardingByOrg.reduce((s, b) => s + b.count, 0) ?? 0;

  return (
    <Card data-testid="card-assistant-metrics">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          Ask VNDRLY usage (last 7 days)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <p className="text-sm text-muted-foreground">Couldn't load metrics: {error}</p>
        ) : data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Stat
                icon={Sparkles}
                label="Sessions"
                value={totalSessions}
                hint={data.sessionsByDay.length > 0 ? `${data.sessionsByDay.length} active days` : "none yet"}
                testid="metric-sessions"
              />
              <Stat
                icon={MessageSquare}
                label="Messages"
                value={totalMessages}
                hint={`${(totalMessages / Math.max(1, totalSessions)).toFixed(1)} per session`}
                testid="metric-messages"
              />
              <Stat
                icon={AlertOctagon}
                label="Refusals"
                value={data.refusalCount}
                hint={`${refusalRate}% of messages`}
                testid="metric-refusals"
              />
              <Stat
                icon={Zap}
                label="Avg first token"
                value={data.ttftMs.avg !== null ? `${data.ttftMs.avg} ms` : "—"}
                hint={
                  data.ttftMs.p95 !== null
                    ? `p95 ${data.ttftMs.p95} ms · n=${data.ttftMs.sample}`
                    : "no samples"
                }
                testid="metric-ttft"
              />
              <Stat
                icon={CheckCircle2}
                label="Onboarded (all-time)"
                value={completedTotal}
                hint={
                  data.completedOnboardingByOrg.length > 0
                    ? data.completedOnboardingByOrg.map((b) => `${b.count} ${b.orgType}`).join(" · ")
                    : "none yet"
                }
                testid="metric-onboarded"
              />
            </div>
            {data.signupAssistant ? (
              <SignupAbuseTile usage={data.signupAssistant} />
            ) : null}
            {/* Tiny per-day spark of *sessions* — that's the headline
                "Assistant usage" signal called out in the task brief.
                Bars are proportional to the max value in the window so
                a slow day still renders something visible. */}
            <Spark days={data.sessionsByDay} rangeDays={data.rangeDays} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  testid,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  hint: string;
  testid: string;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-3" data-testid={testid}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        <span className="font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1 text-lg font-bold leading-none">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function SignupAbuseTile({ usage }: { usage: SignupAssistantUsage }) {
  // Highlight when today's anonymous signup-assistant volume crosses
  // 75% of the daily budget so admins notice script abuse before the
  // circuit breaker trips. Below that we render in muted colour.
  const pct =
    usage.todayBudget > 0
      ? Math.min(100, Math.round((usage.todayUsed / usage.todayBudget) * 100))
      : 0;
  const tripped = usage.todayUsed >= usage.todayBudget && usage.todayBudget > 0;
  const elevated = pct >= 75;
  const tone = tripped
    ? "border-destructive/40 bg-destructive/10"
    : elevated
      ? "border-amber-400/40 bg-amber-100/40 dark:bg-amber-500/10"
      : "border-border bg-muted/20";
  const windowMinutes = Math.max(1, Math.round(usage.ipWindowMs / 60000));
  return (
    <div
      className={`rounded-md border p-3 ${tone}`}
      data-testid="metric-signup-assistant"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldAlert className="w-3.5 h-3.5" />
        <span className="font-medium uppercase tracking-wide">
          Signup help (today)
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="text-lg font-bold leading-none">
          {usage.todayUsed.toLocaleString()}
          <span className="text-sm text-muted-foreground font-normal">
            {" "}
            / {usage.todayBudget.toLocaleString()}
          </span>
        </p>
        <p className="text-[11px] text-muted-foreground">{pct}% of daily budget</p>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {tripped
          ? "Daily circuit breaker open — Anthropic calls paused until UTC midnight."
          : `Active source IPs in last ${windowMinutes} min: ${usage.activeIpBuckets} (limit ${usage.ipMax}/IP).`}
      </p>
    </div>
  );
}

function Spark({ days, rangeDays }: { days: DayBucket[]; rangeDays: number }) {
  // Build a contiguous buckets array so missing days render as zero
  // bars (otherwise the spark looks artificially dense).
  const today = new Date();
  const buckets: DayBucket[] = [];
  const lookup = new Map(days.map((d) => [d.day, d.count]));
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets.push({ day: key, count: lookup.get(key) ?? 0 });
  }
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="flex items-end gap-1 h-12" data-testid="metric-spark">
      {buckets.map((b) => (
        <div
          key={b.day}
          className="flex-1 bg-primary/70 rounded-t"
          style={{ height: `${(b.count / max) * 100}%`, minHeight: "2px" }}
          title={`${b.day}: ${b.count} session${b.count === 1 ? "" : "s"}`}
        />
      ))}
    </div>
  );
}
