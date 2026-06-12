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
import ImagePill, { type ImagePillColor } from "@/components/image-pill";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type PartnerRelationshipRow = {
  partnerId: number;
  partnerName: string;
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
    { labelKey: string; color: ImagePillColor; rest?: boolean }
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
      rest: true,
    },
  };
  const cfg = map[status] ?? map.unaffiliated;
  return (
    <ImagePill
      color={cfg.color}
      rest={cfg.rest}
      className="min-w-[98px] pointer-events-none"
      data-testid={`badge-relationship-${status}`}
    >
      {t(cfg.labelKey)}
    </ImagePill>
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

  return (
    <Card data-testid="card-vendor-partner-relationships">
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
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {t("approvals.noPartnerRelationships")}
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((r) => (
              <div
                key={r.partnerId}
                className={cn(
                  CARD_INNER_TILE_HOVER_CLASS,
                  "group flex items-center gap-3",
                )}
                data-testid={`row-partner-relationship-${r.partnerId}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Handshake
                      className="w-4 h-4 shrink-0 card-icon-drop-shadow"
                      style={{ color: "var(--brand-primary)" }}
                      aria-hidden
                      data-testid={`icon-partner-row-${r.partnerId}`}
                    />
                    <Link
                      href={`/partners/${r.partnerId}`}
                      className="hotlist-job-title font-semibold text-gray-700 truncate text-left transition-[color,text-shadow] hover:text-[var(--brand-primary)]"
                      data-testid={`link-partner-relationship-${r.partnerId}`}
                    >
                      {r.partnerName}
                    </Link>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 grid grid-cols-1 sm:grid-cols-3 gap-1">
                    <span>
                      {t("approvals.ratedAt")}: {fmt(r.ratedAt)}
                    </span>
                    <span>
                      {t("approvals.approvedAt")}: {fmt(r.approvedAt)}
                    </span>
                    <span>
                      {t("approvals.approvedBy")}: {r.approvedByUsername ?? "—"}
                    </span>
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
                        className="text-xs text-gray-700 hover:text-[var(--brand-primary)] hover:underline transition-colors inline-flex items-center gap-1"
                        data-testid={`link-billing-settings-${r.partnerId}`}
                      >
                        <Receipt className="w-3 h-3" />
                        {t("invoices.billingSettings.editLink")}
                      </Link>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge status={r.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
