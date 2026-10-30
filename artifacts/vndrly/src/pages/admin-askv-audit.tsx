import { CardHeading } from "@/components/ui/card-heading";
import { ContentCardHeader } from "@/components/ui/card";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, RefreshCcw, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import ContentPaneBackLink from "@/components/content-pane-back-link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type AuditStatus = "all" | "success" | "requires_confirmation" | "failed" | "cancelled";

type AskVActionAuditRow = {
  id: number;
  createdAt: string;
  userId: number | null;
  userDisplayName: string | null;
  userEmail: string | null;
  actorRole: string | null;
  actorMembershipRole: string | null;
  partnerId: number | null;
  vendorId: number | null;
  vendorPeopleId: number | null;
  clientSurface: string;
  inputMode: string;
  provider: string;
  toolName: string;
  actionType: string;
  targetType: string | null;
  targetId: string | null;
  confirmationPhrase: string | null;
  resultStatus: string;
  errorCode: string | null;
  errorMessage: string | null;
  hasGps: boolean;
  hasToolInput: boolean;
  hasToolOutput: boolean;
};

type AskVActionAuditResponse = {
  limit: number;
  status: string | null;
  rows: AskVActionAuditRow[];
};

const STATUS_OPTIONS: Array<{ value: AuditStatus; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "success", label: "Success" },
  { value: "requires_confirmation", label: "Needs confirmation" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "success") return "default";
  if (status === "failed") return "destructive";
  if (status === "requires_confirmation") return "secondary";
  return "outline";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function targetHref(row: AskVActionAuditRow): string | null {
  if (!row.targetType || !row.targetId) return null;
  if (row.targetType === "ticket" && /^\d+$/.test(row.targetId)) {
    return `/tickets/${row.targetId}`;
  }
  if (row.targetType === "invoice" && /^\d+$/.test(row.targetId)) {
    return `/invoices/${row.targetId}`;
  }
  if (row.targetType === "site_location" && /^\d+$/.test(row.targetId)) {
    return `/site-locations/${row.targetId}`;
  }
  return null;
}

function MetricCard({
  label,
  value,
  testId,
}: {
  label: string;
  value: number;
  testId: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <CardHeading as="h3" className="text-xs uppercase">{label}</CardHeading>
        <div className="text-2xl font-semibold tabular-nums" data-testid={testId}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function AuditRow({ row }: { row: AskVActionAuditRow }) {
  const href = targetHref(row);
  const actorLabel = [row.actorRole, row.actorMembershipRole].filter(Boolean).join(" / ");
  const targetLabel =
    row.targetType && row.targetId ? `${row.targetType} #${row.targetId}` : "No target";

  return (
    <TableRow data-testid={`row-askv-action-audit-${row.id}`}>
      <TableCell className="align-top whitespace-nowrap">
        <div className="font-mono text-xs">{formatDateTime(row.createdAt)}</div>
        <div className="text-xs text-muted-foreground">{row.clientSurface} / {row.inputMode}</div>
      </TableCell>
      <TableCell className="align-top">
        <div className="font-medium">{row.userDisplayName ?? "Unknown user"}</div>
        <div className="text-xs text-muted-foreground">{actorLabel || row.userEmail || "No role"}</div>
      </TableCell>
      <TableCell className="align-top">
        <div className="font-mono text-xs">{row.toolName}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          <Badge variant="outline">{row.actionType}</Badge>
          <Badge variant="outline">{row.provider}</Badge>
          {row.hasGps && (
            <Badge variant="secondary" data-testid={`badge-askv-audit-gps-${row.id}`}>
              GPS
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="align-top">
        {href ? (
          <a className="text-primary underline-offset-2 hover:underline" href={href}>
            {targetLabel}
          </a>
        ) : (
          <span>{targetLabel}</span>
        )}
      </TableCell>
      <TableCell className="align-top">
        <Badge variant={statusVariant(row.resultStatus)}>
          {row.resultStatus.replace(/_/g, " ")}
        </Badge>
        {row.confirmationPhrase && (
          <div className="mt-1 text-xs text-muted-foreground">
            Confirmed: {row.confirmationPhrase}
          </div>
        )}
      </TableCell>
      <TableCell className="align-top max-w-[260px]">
        {row.errorMessage ? (
          <div>
            <div className="text-sm text-destructive">{row.errorMessage}</div>
            {row.errorCode && (
              <code className="text-xs text-muted-foreground">{row.errorCode}</code>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">No error</span>
        )}
      </TableCell>
    </TableRow>
  );
}

export default function AdminAskVAudit() {
  const { user } = useAuth();
  const [status, setStatus] = useState<AuditStatus>("all");
  const isAdmin = user?.role === "admin";

  const { data, isLoading, isError, error, refetch, isFetching } =
    useQuery<AskVActionAuditResponse>({
      queryKey: ["admin", "askv-action-audit", status],
      queryFn: async () => {
        const params = new URLSearchParams({ limit: "50" });
        if (status !== "all") params.set("status", status);
        const res = await fetch(`${API_BASE}/api/assistant/action-audit?${params}`, {
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

  const metrics = useMemo(() => {
    const rows = data?.rows ?? [];
    return {
      total: rows.length,
      success: rows.filter((row) => row.resultStatus === "success").length,
      needsConfirmation: rows.filter((row) => row.resultStatus === "requires_confirmation").length,
      failed: rows.filter((row) => row.resultStatus === "failed" || row.resultStatus === "cancelled").length,
    };
  }, [data?.rows]);

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
          <Bot className="w-6 h-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-askv-audit-title">
              AskV Action Audit
            </h1>
            <p className="text-sm text-muted-foreground">
              Review recent AskV tool calls, confirmations, failures, and client surfaces.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as AuditStatus)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            data-testid="select-askv-audit-status"
            aria-label="Filter by result status"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <PillButton
            color="image"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-askv-audit"
          >
            <RefreshCcw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </PillButton>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Returned" value={metrics.total} testId="metric-askv-audit-total" />
        <MetricCard label="Succeeded" value={metrics.success} testId="metric-askv-audit-success" />
        <MetricCard label="Needs confirmation" value={metrics.needsConfirmation} testId="metric-askv-audit-confirmation" />
        <MetricCard label="Failed or cancelled" value={metrics.failed} testId="metric-askv-audit-failed" />
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {isError && (
        <Card>
        <ContentCardHeader title="Ask V audit" spanish="Auditoría de Ask V" />
          <CardContent className="p-6 text-sm text-destructive">
            Failed to load AskV action audit:{" "}
            {error instanceof Error ? error.message : "unknown error"}
          </CardContent>
        </Card>
      )}

      {data && data.rows.length === 0 && (
        <Card>
        <ContentCardHeader title="Ask V audit" spanish="Auditoría de Ask V" />
          <CardContent className="p-6 text-sm text-muted-foreground">
            No AskV action audit rows match this filter.
          </CardContent>
        </Card>
      )}

      {data && data.rows.length > 0 && (
        <Card>
        <ContentCardHeader title="Ask V audit" spanish="Auditoría de Ask V" />
          <CardContent className="p-0">
            <div className="flex items-center gap-2 border-b px-4 py-3 text-sm text-muted-foreground">
              <ShieldCheck className="w-4 h-4" />
              Raw tool payloads and exact coordinates are omitted from this list.
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Tool</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((row) => (
                    <AuditRow key={row.id} row={row} />
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
