import StatusIndicator, { type INDICATOR_COLORS } from "@/components/status-indicator";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGetPartner, getGetPartnerQueryKey, getGetPartnerQueryOptions } from "@workspace/api-client-react";
import { PosterThumbnail } from "@/components/poster-preview";
import { useQuery, useQueries } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CARD_INNER_TILE_HOVER_CLASS,
  CARD_TITLE_ICON_CLASS,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Handshake, Receipt, Search } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { cn, formatPhone } from "@/lib/utils";
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
    { labelKey: string; color: keyof typeof INDICATOR_COLORS }
  > = {
    preferred: {
      labelKey: "approvals.status.preferred",
      color: "amber",
    },
    approved: {
      labelKey: "approvals.status.approved",
      color: "green",
    },
    unaffiliated: {
      labelKey: "approvals.status.unaffiliated",
      color: "grey",
    },
    pending_review: { labelKey: "approvals.status.pending_review", color: "amber" },
    auto_unapproved: { labelKey: "approvals.status.auto_unapproved", color: "amber" },
    revoked: { labelKey: "approvals.status.revoked", color: "grey" },
  };
  const cfg = map[status] ?? map.unaffiliated;
  return (
    <StatusIndicator color={cfg.color} data-testid={`badge-relationship-${status}`}>
      {t(cfg.labelKey)}
    </StatusIndicator>
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

function PartnerDetails({ partnerId }: { partnerId: number }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { data: partner, isLoading, isError } = useGetPartner(partnerId, {
    query: { enabled: expanded, queryKey: getGetPartnerQueryKey(partnerId) },
  });
  return (
    <details className="vendor-partner-group mt-2" onToggle={event => setExpanded(event.currentTarget.open)} data-testid={`partner-contact-details-${partnerId}`}>
      <summary>{t("approvals.partnerDetails")}</summary>
      {expanded && (isLoading ? <Skeleton className="h-20 w-full" /> : isError ? (
        <p role="alert" className="py-2 text-xs text-muted-foreground">{t("approvals.partnerDetailsFailed")}</p>
      ) : partner ? (
        <div className="flex min-w-0 flex-wrap items-start gap-4 py-2">
          <dl className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
            <dt className="text-muted-foreground">{t("partners.contact")}</dt><dd className="break-words text-[#ececec]">{partner.contactName || "—"}</dd>
            <dt className="text-muted-foreground">{t("partners.contactEmail")}</dt><dd className="min-w-0 break-all">{partner.contactEmail ? <a className="text-[var(--brand-primary)] hover:underline" href={`mailto:${partner.contactEmail}`}>{partner.contactEmail}</a> : "—"}</dd>
            <dt className="text-muted-foreground">{t("partners.contactPhone")}</dt><dd>{partner.contactPhone ? <a className="text-[var(--brand-primary)] hover:underline" href={`tel:${partner.contactPhone}`}>{formatPhone(partner.contactPhone)}</a> : "—"}</dd>
            <dt className="text-muted-foreground">{t("tickets.created")}</dt><dd className="text-[#ececec]">{fmt(partner.createdAt)}</dd>
          </dl>
          <PosterThumbnail partnerId={partner.id} partnerName={partner.name} primaryColor={partner.brandPrimaryColor} accentColor={partner.brandAccentColor} logoUrl={partner.logoUrl} />
        </div>
      ) : null)}
    </details>
  );
}

export default function VendorPartnerRelationshipsCard({
  vendorId,
}: {
  vendorId: number;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
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
  const query = search.trim().toLowerCase();
  const partnerDetails = useQueries({ queries: items.map(row => getGetPartnerQueryOptions(row.partnerId, { query: { enabled: !!query, queryKey: getGetPartnerQueryKey(row.partnerId) } })) });
  const matchingItems = items.filter((row, index) => {
    const partner = partnerDetails[index]?.data;
    return !query || [row.partnerName, partner?.contactName, partner?.contactEmail, partner?.contactPhone]
      .some(value => value?.toLowerCase().includes(query));
  });
  const groups = [
    { key: "current", label: "approvals.currentPartners", empty: "approvals.noCurrentPartners", rows: matchingItems.filter(row => row.status !== "revoked") },
    { key: "former", label: "approvals.formerPartners", empty: "approvals.noFormerPartners", rows: matchingItems.filter(row => row.status === "revoked") },
  ];

  return (
    <Card id="partner-approvals" data-testid="card-vendor-partner-relationships">
      <CardHeader className="partner-approvals-header">
        <CardTitle className="flex items-center gap-2">
          <Handshake
            className={CARD_TITLE_ICON_CLASS}
            style={{ color: "var(--brand-primary)" }}
          />
          {t("approvals.partnerApprovals", { count: items.length })}
        </CardTitle>
        <label className="partner-approvals-search">
          <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <input type="search" aria-label={t("approvals.searchPartners")} placeholder={t("approvals.searchPartners")} value={search} onChange={event => setSearch(event.target.value)} data-testid="input-search-partner" />
        </label>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="space-y-2">
            {groups.map(group => <details key={`${group.key}-${!!query}`} open={group.key === "current" || !!query} className="vendor-partner-group" data-testid={`partner-group-${group.key}`}>
              <summary>{t(group.label)} <span className="ml-auto tabular-nums">{group.rows.length}</span></summary>
              <div className="space-y-2 pb-2">
              {group.rows.length === 0 && <p className="py-2 text-xs text-muted-foreground">{t(query ? "approvals.noSearchMatches" : group.empty)}</p>}
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
                  <PartnerDetails partnerId={r.partnerId} />
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
