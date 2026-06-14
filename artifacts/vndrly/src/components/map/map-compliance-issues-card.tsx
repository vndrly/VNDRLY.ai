import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { AlertTriangle, BellRing, ShieldAlert } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CARD_INNER_TILE_CLICKABLE_CLASS,
  CARD_TITLE_ICON_CLASS,
} from "@/components/ui/card";
import { PngPillButton } from "@/components/png-pill-rollover";
import { useBrand } from "@/hooks/use-brand";
import { useToast } from "@/hooks/use-toast";
import { translateApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ComplianceIssue = {
  employeeId: number;
  employeeName: string;
  vendorName: string | null;
  ticketId: number;
  issueType: "missing" | "expired" | "expiring_soon";
  certName: string;
  expirationDate: string | null;
};

type Props = {
  siteLocationId: number | null;
  className?: string;
};

export function MapComplianceIssuesCard({ siteLocationId, className }: Props) {
  const { t } = useTranslation();
  const brand = useBrand();
  const { toast } = useToast();
  const iconStyle = { color: brand.isOrgBranded ? brand.primary : "#dc2626" };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["site-map-compliance", siteLocationId],
    enabled: siteLocationId != null,
    queryFn: async () => {
      const r = await fetch(
        `${API_BASE}/api/site-map/${siteLocationId}/compliance-issues?limit=50`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("compliance fetch failed");
      return (await r.json()) as { issues: ComplianceIssue[] };
    },
    refetchInterval: 60_000,
  });

  const issues = data?.issues ?? [];
  const preview = issues.slice(0, 5);

  const nudge = async (ticketId: number) => {
    try {
      const r = await fetch(`${API_BASE}/api/tickets/${ticketId}/nudge`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction: "down", message: "Compliance issue on site — please resolve." }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(body?.message ?? "nudge failed"), { data: body });
      toast({ title: t("mapCompliance.nudgeSent") });
    } catch (e) {
      toast({
        variant: "destructive",
        title: t("common.error"),
        description: translateApiError(e, t),
      });
    }
  };

  const issueLabel = (issue: ComplianceIssue) => {
    if (issue.issueType === "missing") {
      return t("mapCompliance.missing", { cert: issue.certName });
    }
    if (issue.issueType === "expired") {
      return t("mapCompliance.expired", { cert: issue.certName });
    }
    return t("mapCompliance.expiringSoon", { cert: issue.certName, date: issue.expirationDate ?? "" });
  };

  return (
    <Card className={cn("mt-4", className)} data-testid="card-map-compliance">
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className={CARD_TITLE_ICON_CLASS} style={iconStyle} />
          {t("mapCompliance.title")} ({siteLocationId != null ? issues.length : 0})
        </CardTitle>
        {siteLocationId != null ? (
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => void refetch()}
          >
            {t("common.refresh")}
          </button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2 max-h-[280px] overflow-y-auto">
        {siteLocationId == null ? (
          <p className="text-sm text-muted-foreground">{t("mapCompliance.pickSite")}</p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : preview.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("mapCompliance.empty")}</p>
        ) : (
          preview.map((issue) => (
            <div
              key={`${issue.ticketId}-${issue.employeeId}-${issue.certName}`}
              className={cn(CARD_INNER_TILE_CLICKABLE_CLASS, "text-sm space-y-1.5")}
            >
              <div className="font-medium flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                {issue.employeeName}
              </div>
              <div className="text-xs text-muted-foreground">{issueLabel(issue)}</div>
              {issue.vendorName ? (
                <div className="text-xs text-muted-foreground">{issue.vendorName}</div>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <Link href={`/tickets/${issue.ticketId}`} className="text-xs underline">
                  #{issue.ticketId}
                </Link>
                <PngPillButton
                  color="amber"
                  className="h-[23px] min-h-[23px] px-2"
                  onClick={() => void nudge(issue.ticketId)}
                >
                  <span className="inline-flex items-center gap-1 text-xs">
                    <BellRing className="h-3 w-3" />
                    {t("mapCompliance.nudge")}
                  </span>
                </PngPillButton>
              </div>
            </div>
          ))
        )}
        {issues.length > 5 ? (
          <p className="text-xs text-muted-foreground pt-1">
            {t("mapCompliance.scrollHint", { count: issues.length })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
