import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CARD_INNER_TILE_HOVER_CLASS,
  CARD_TITLE_ICON_CLASS,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Handshake, Receipt } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import PartnerApprovalLogo from "@/components/partner-approval-logo";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type PartnerRelationshipRow = {
  partnerId: number;
  partnerName: string;
  partnerLogoUrl: string | null;
  partnerLogoSquareUrl: string | null;
  status: string;
  notes: string | null;
  ratedAt: string | null;
  approvedAt: string | null;
  approvedByUsername: string | null;
};

async function jsonFetch<T>(input: string): Promise<T> {
  const res = await fetch(`${BASE}${input}`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const map: Record<
    string,
    { labelKey: string; color: string }
  > = {
    preferred: {
      labelKey: "approvals.status.preferred",
      color: "text-amber-500",
    },
    approved: {
      labelKey: "approvals.status.approved",
      color: "text-green-600",
    },
    unaffiliated: {
      labelKey: "approvals.status.unaffiliated",
      color: "text-muted-foreground",
    },
    pending_review: { labelKey: "approvals.status.pending_review", color: "text-amber-500" },
    auto_unapproved: { labelKey: "approvals.status.auto_unapproved", color: "text-amber-500" },
    revoked: { labelKey: "approvals.status.revoked", color: "text-muted-foreground" },
  };
  const cfg = map[status] ?? map.unaffiliated;
  return (
    <span
      role="status"
      className={cn("inline-flex min-h-[26px] items-center justify-center gap-[5px] rounded-full bg-white/[0.055] px-[10px] py-[3px] text-xs font-semibold", cfg.color)}
      data-testid={`badge-relationship-${status}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      <span>{t(cfg.labelKey)}</span>
    </span>
  );
}

function fmt(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return "—";
  }
}

export default function VendorPartnerRelationshipsCard({
  vendorId,
}: {
  vendorId: number;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canEditBilling =
    user?.role === "admin" ||
    (user?.role === "vendor" && user?.vendorId === vendorId);
  const { data, isLoading } = useQuery({
    queryKey: ["vendor-partner-relationships", vendorId],
    queryFn: () =>
      jsonFetch<{ vendorId: number; items: PartnerRelationshipRow[] }>(
        `/api/vendors/${vendorId}/partner-relationships`,
      ),
    enabled: !!vendorId,
  });

  const items = data?.items ?? [];
  const groups = [
    { key: "current", label: "approvals.currentPartners", empty: "approvals.noCurrentPartners", rows: items.filter(row => row.status !== "revoked") },
    { key: "former", label: "approvals.formerPartners", empty: "approvals.noFormerPartners", rows: items.filter(row => row.status === "revoked") },
  ];

  return (
    <Card id="partner-approvals" data-testid="card-vendor-partner-relationships">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Handshake
            className={CARD_TITLE_ICON_CLASS}
            style={{ color: "var(--brand-primary)" }}
          />
          {t("approvals.partnerApprovals", { count: items.length })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="space-y-2">
            {groups.map(group => <details key={group.key} open={group.key === "current"} className="vendor-partner-group" data-testid={`partner-group-${group.key}`}>
              <summary>{t(group.label)} <span className="ml-auto tabular-nums">{group.rows.length}</span></summary>
              <div className="space-y-2 pb-2">
              {group.rows.length === 0 && <p className="py-2 text-xs text-muted-foreground">{t(group.empty)}</p>}
            {group.rows.map((r) => (
              <div
                key={r.partnerId}
                className={cn(
                  CARD_INNER_TILE_HOVER_CLASS,
                  "group flex min-h-14 items-center gap-3",
                )}
                data-testid={`row-partner-relationship-${r.partnerId}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                <PartnerApprovalLogo partnerId={r.partnerId} partnerName={r.partnerName} logoUrl={r.partnerLogoUrl} squareLogoUrl={r.partnerLogoSquareUrl} />
                    <Link
                      href={`/partners/${r.partnerId}`}
                      className="hotlist-job-title min-w-0 font-semibold text-[#ececec] truncate text-left transition-[color,text-shadow] hover:text-[var(--brand-primary)]"
                      data-testid={`link-partner-relationship-${r.partnerId}`}
                    >
                      {r.partnerName}
                    </Link>
                    <div className="ml-auto shrink-0">
                      <StatusBadge status={r.status} />
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex items-start justify-between gap-2">
                    <span className="shrink-0">
                      {t("approvals.ratedAt")}: {fmt(r.ratedAt)}
                    </span>
                    <div className="ml-auto flex min-w-0 flex-wrap justify-end gap-x-3 gap-y-1 text-right" data-testid={`approval-details-${r.partnerId}`}>
                      <span className="break-all">{r.approvedByUsername ?? "—"}</span>
                      <span>{fmt(r.approvedAt)}</span>
                    </div>
                  </div>
                  {r.notes && (
                    <p className="text-xs text-muted-foreground mt-1 italic">
                      "{r.notes}"
                    </p>
                  )}
                  {canEditBilling && (
                    <div className="mt-2">
                      <Link
                        href={`/billing-settings/${vendorId}/${r.partnerId}`}
                        className="text-xs text-[var(--brand-primary)] hover:underline transition-colors inline-flex items-center gap-1"
                        data-testid={`link-billing-settings-${r.partnerId}`}
                      >
                        <Receipt className="w-3 h-3" />
                        {t("invoices.billingSettings.editLink")}
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            ))}
              </div>
            </details>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
