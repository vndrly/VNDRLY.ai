import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Handshake, Receipt } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import BrandRolePill from "@/components/brand-role-pill";
import PngPill from "@/components/png-pill-rollover";

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
  const map: Record<string, { label: string; tone: "amber" | "green" | "grey" }> = {
    preferred: {
      label: t("approvals.status.preferred"),
      tone: "amber",
    },
    approved: {
      label: t("approvals.status.approved"),
      tone: "green",
    },
    unaffiliated: {
      label: t("approvals.status.unaffiliated"),
      tone: "grey",
    },
  };
  const cfg = map[status] ?? map.unaffiliated;
  // Unaffiliated has no signal — render the canonical TogglePill
  // rest chrome (light-grey PNG + diagonal gloss) so it reads as
  // "no action / no status" instead of a saturated grey chip.
  if (cfg === map.unaffiliated) {
    return (
      <PngPill
        rest

        data-testid={`badge-relationship-${status}`}
      >
        {cfg.label}
      </PngPill>
    );
  }
  return (
    <BrandRolePill
      tone={cfg.tone}

      testId={`badge-relationship-${status}`}
    >
      {cfg.label}
    </BrandRolePill>
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
          <Handshake className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />
          {t("approvals.partnerApprovals", { count: items.length })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("approvals.noPartnerRelationships")}
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((r) => (
              <div
                key={r.partnerId}
                className="border rounded-md p-3 flex items-start gap-3"
                data-testid={`row-partner-relationship-${r.partnerId}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Always-branded handshake icon — does NOT change
                        on hover/focus/status. Mirrors the card-title
                        Handshake motif so each row reads as a partner
                        relationship. The link beside it keeps its own
                        dark-grey → primary-on-hover behavior. */}
                    <Handshake
                      className="w-4 h-4 shrink-0"
                      style={{ color: "var(--brand-primary)" }}
                      aria-hidden
                      data-testid={`icon-partner-row-${r.partnerId}`}
                    />
                    <Link
                      href={`/partners/${r.partnerId}`}
                      className="font-medium text-gray-700 transition-colors hover:[color:var(--brand-primary)] hover:underline"
                    >
                      {r.partnerName}
                    </Link>
                    <StatusBadge status={r.status} />
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
                        className="text-xs text-gray-700 transition-colors hover:[color:var(--brand-primary)] hover:underline inline-flex items-center gap-1"
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
        )}
      </CardContent>
    </Card>
  );
}
