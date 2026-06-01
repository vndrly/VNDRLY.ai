import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/api-error";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Users, Receipt, AlertTriangle } from "lucide-react";
import { PngPillButton } from "@/components/png-pill-rollover";
import BrandRolePill from "@/components/brand-role-pill";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type RelStatus =
  | "approved"
  | "pending_review"
  | "auto_unapproved"
  | "revoked";

type RelRow = {
  vendorId: number;
  vendorName: string;
  status: RelStatus | string;
  notes: string | null;
  ratedAt: string | null;
  approvedAt: string | null;
  approvedByUsername: string | null;
  approvedCatalogVersionId: number | null;
  currentCatalogVersionId: number | null;
  lastStatusReason: string | null;
  lastStatusChangeAt: string | null;
};

type SiteAfeRow = {
  siteLocationId: number;
  name: string;
  siteCode: string | null;
  address: string | null;
  afe: string;
};

type CatalogVersion = {
  id: number;
  version: number;
  publishedAt: string;
  changeSummary: string | null;
  eulaText: string;
  eulaHash: string;
  ratesSnapshot: Record<string, unknown> | null;
  workTypesSnapshot: Array<{
    workTypeId: number;
    workTypeName: string;
    unitPrice: string | null;
    unit: string | null;
    currency: string | null;
  }> | null;
  complianceSnapshot: Record<string, unknown> | null;
};

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${input}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error || j.message || msg;
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const map: Record<
    string,
    { labelKey: string; tone: "amber" | "green" | "grey" | "red" }
  > = {
    approved: { labelKey: "approvals.status.approved", tone: "green" },
    pending_review: {
      labelKey: "approvals.status.pending_review",
      tone: "amber",
    },
    auto_unapproved: {
      labelKey: "approvals.status.auto_unapproved",
      tone: "amber",
    },
    revoked: { labelKey: "approvals.status.revoked", tone: "red" },
  };
  const cfg = map[status] ?? map.pending_review;
  // BrandRolePill only knows "amber" | "green" | "grey" — fold "red"
  // back to "grey" so we never break the build, and flag it with the
  // explicit testid so e2e tests can still assert the variant.
  const tone = cfg.tone === "red" ? "grey" : cfg.tone;
  return (
    <BrandRolePill
      tone={tone}

      testId={`badge-relationship-${status}`}
    >
      {t(cfg.labelKey)}
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

// Modal that walks an admin through accepting the vendor's current
// EULA and (optionally) editing approval notes + per-site AFE codes.
// On submit it POSTs accept-eula then PUTs the relationship status to
// `approved`. The server enforces the same EULA gate, so this UI is
// guidance, not the source of truth.
function ApproveModal({
  partnerId,
  vendor,
  open,
  onOpenChange,
  onSaved,
}: {
  partnerId: number;
  vendor: RelRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [notes, setNotes] = useState(vendor.notes ?? "");
  const [eulaAccepted, setEulaAccepted] = useState(false);
  useEffect(() => {
    if (open) {
      setNotes(vendor.notes ?? "");
      setEulaAccepted(false);
    }
  }, [open, vendor.notes]);

  // Pull the vendor's current catalog version so we can render its
  // EULA + summary inline. The accept-eula POST below sends the
  // version id so the server can refuse if the vendor publishes
  // a new version mid-flow.
  const { data: currentData, isLoading: loadingCurrent } = useQuery({
    queryKey: ["vendor-catalog-current", vendor.vendorId, open],
    queryFn: () =>
      jsonFetch<{ version: CatalogVersion | null }>(
        `/api/vendors/${vendor.vendorId}/catalog/current`,
      ),
    enabled: open,
  });
  const current = currentData?.version ?? null;

  const afeKey = ["vendor-site-afes", partnerId, vendor.vendorId];
  const { data: afeData, isLoading: loadingAfes } = useQuery({
    queryKey: afeKey,
    queryFn: () =>
      jsonFetch<{ items: SiteAfeRow[] }>(
        `/api/partners/${partnerId}/vendors/${vendor.vendorId}/site-location-afes`,
      ),
    enabled: open,
  });
  const [afeDraft, setAfeDraft] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    if (!afeData) return;
    const m = new Map<number, string>();
    for (const r of afeData.items) m.set(r.siteLocationId, r.afe ?? "");
    setAfeDraft(m);
  }, [afeData]);

  const promote = useMutation({
    mutationFn: async () => {
      // 1) Record EULA acceptance pinned to the version id we showed.
      if (current?.id) {
        await jsonFetch(
          `/api/partners/${partnerId}/vendor-relationships/${vendor.vendorId}/accept-eula`,
          {
            method: "POST",
            body: JSON.stringify({ catalogVersionId: current.id }),
          },
        );
      }
      // 2) Promote.
      await jsonFetch(
        `/api/partners/${partnerId}/vendor-relationships/${vendor.vendorId}`,
        {
          method: "PUT",
          body: JSON.stringify({ status: "approved", notes: notes || null }),
        },
      );
      // 3) AFE batch.
      if (afeData) {
        const items = afeData.items.map((r) => ({
          siteLocationId: r.siteLocationId,
          afe: afeDraft.get(r.siteLocationId) ?? "",
        }));
        await jsonFetch(
          `/api/partners/${partnerId}/vendors/${vendor.vendorId}/site-location-afes`,
          { method: "PUT", body: JSON.stringify({ items }) },
        );
      }
    },
    onSuccess: () => {
      toast({ title: t("approvals.approvedToast", { name: vendor.vendorName }) });
      onSaved();
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast({
        title: translateApiError(e, t, t("approvals.approveFailedToast")),
        variant: "destructive",
      }),
  });

  const canSubmit = eulaAccepted && !promote.isPending && !loadingCurrent;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("approvals.approveTitle", { name: vendor.vendorName })}
          </DialogTitle>
          <DialogDescription>
            {t("approvals.approveSubtitle")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* EULA panel */}
          <div className="space-y-2 border rounded-md p-3 bg-muted/20">
            <Label className="font-semibold">
              {t("approvals.eulaSectionLabel")}
            </Label>
            {loadingCurrent ? (
              <Skeleton className="h-24 w-full" />
            ) : !current ? (
              <p
                className="text-sm text-muted-foreground"
                data-testid="text-no-catalog-version"
              >
                {t("approvals.noCatalogVersion")}
              </p>
            ) : (
              <>
                <div className="text-xs text-muted-foreground">
                  {t("approvals.eulaVersionLabel", {
                    version: current.version,
                    publishedAt: fmt(current.publishedAt),
                  })}
                </div>
                {current.changeSummary ? (
                  <div className="text-xs italic text-muted-foreground">
                    “{current.changeSummary}”
                  </div>
                ) : null}
                <pre
                  className="whitespace-pre-wrap text-xs border rounded-md bg-background p-2 max-h-48 overflow-y-auto"
                  data-testid="text-eula-body"
                >
                  {current.eulaText}
                </pre>
                <label className="flex items-start gap-2 text-sm pt-1">
                  <Checkbox
                    checked={eulaAccepted}
                    onCheckedChange={(v) => setEulaAccepted(!!v)}
                    data-testid="checkbox-accept-eula"
                  />
                  <span>{t("approvals.acceptEulaLabel")}</span>
                </label>
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t("approvals.notesLabel")}</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("approvals.notesPlaceholder")}
              rows={3}
              data-testid="textarea-approval-notes"
            />
            <p className="text-xs text-muted-foreground">
              {t("approvals.notesHelp")}
            </p>
          </div>

          <div className="space-y-2">
            <Label>{t("approvals.afeSectionLabel")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("approvals.afeSectionHelp")}
            </p>
            {loadingAfes ? (
              <Skeleton className="h-16 w-full" />
            ) : !afeData || afeData.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("approvals.noSites")}
              </p>
            ) : (
              <div className="space-y-2 border rounded-md p-3 bg-muted/20">
                {afeData.items.map((r) => (
                  <div
                    key={r.siteLocationId}
                    className="grid grid-cols-1 sm:grid-cols-[1fr_180px] items-center gap-2"
                    data-testid={`row-afe-site-${r.siteLocationId}`}
                  >
                    <div className="text-sm">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.siteCode ? `${r.siteCode} · ` : ""}
                        {r.address ?? ""}
                      </div>
                    </div>
                    <Input
                      value={afeDraft.get(r.siteLocationId) ?? ""}
                      onChange={(e) =>
                        setAfeDraft((prev) => {
                          const next = new Map(prev);
                          next.set(r.siteLocationId, e.target.value);
                          return next;
                        })
                      }
                      placeholder={t("approvals.afePlaceholder")}
                      className="h-8"
                      data-testid={`input-afe-site-${r.siteLocationId}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <PngPillButton
            className="px-3"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </PngPillButton>
          <PngPillButton
            color="amber"
            className="px-3"
            onClick={() => promote.mutate()}
            disabled={!canSubmit}
            data-testid="button-confirm-approve"
          >
            {promote.isPending
              ? t("approvals.saving")
              : t("approvals.approveAndSave")}
          </PngPillButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Side-by-side modal showing the catalog version the partner last
// approved against the vendor's currently-published version. Strictly
// informational — re-approve flows back through ApproveModal.
function CatalogDiffModal({
  vendor,
  open,
  onOpenChange,
}: {
  vendor: RelRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const { data: currentData, isLoading: loadingCurrent } = useQuery({
    queryKey: ["vendor-catalog-current", vendor.vendorId, "diff", open],
    queryFn: () =>
      jsonFetch<{ version: CatalogVersion | null }>(
        `/api/vendors/${vendor.vendorId}/catalog/current`,
      ),
    enabled: open,
  });
  const { data: prevData, isLoading: loadingPrev } = useQuery({
    queryKey: ["vendor-catalog-version", vendor.approvedCatalogVersionId],
    queryFn: () =>
      jsonFetch<CatalogVersion>(
        `/api/vendor-catalog-versions/${vendor.approvedCatalogVersionId}`,
      ),
    enabled: open && !!vendor.approvedCatalogVersionId,
  });
  const current = currentData?.version ?? null;
  const previous = prevData ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("approvals.diffTitle", { name: vendor.vendorName })}
          </DialogTitle>
          <DialogDescription>
            {t("approvals.diffSubtitle")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <DiffColumn
            heading={t("approvals.diffPrevHeading")}
            version={previous}
            loading={loadingPrev}
            empty={t("approvals.diffPrevEmpty")}
          />
          <DiffColumn
            heading={t("approvals.diffCurrentHeading")}
            version={current}
            loading={loadingCurrent}
            empty={t("approvals.diffCurrentEmpty")}
          />
        </div>
        <DialogFooter>
          <PngPillButton
            className="px-3"
            onClick={() => onOpenChange(false)}
          >
            {t("common.close")}
          </PngPillButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiffColumn({
  heading,
  version,
  loading,
  empty,
}: {
  heading: string;
  version: CatalogVersion | null;
  loading: boolean;
  empty: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="border rounded-md p-3 space-y-2 bg-muted/10">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {heading}
      </div>
      {loading ? (
        <Skeleton className="h-20 w-full" />
      ) : !version ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <>
          <div className="text-xs text-muted-foreground">
            {t("approvals.eulaVersionLabel", {
              version: version.version,
              publishedAt: fmt(version.publishedAt),
            })}
          </div>
          {version.changeSummary ? (
            <div className="text-xs italic text-muted-foreground">
              “{version.changeSummary}”
            </div>
          ) : null}
          <ul className="text-xs space-y-1 max-h-48 overflow-y-auto">
            {(version.workTypesSnapshot ?? []).map((wt) => (
              <li
                key={wt.workTypeId}
                className="flex items-center justify-between gap-2"
                data-testid={`diff-work-type-${wt.workTypeId}`}
              >
                <span className="truncate">{wt.workTypeName}</span>
                <span className="text-muted-foreground tabular-nums">
                  {wt.unitPrice ?? "—"} {wt.currency ?? ""}{" "}
                  {wt.unit ? `/ ${wt.unit}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default function PartnerVendorApprovalsCard({
  partnerId,
  canManage,
}: {
  partnerId: number;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { toast } = useToast();
  const qc = useQueryClient();
  const queryKey = ["partner-vendor-relationships", partnerId];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      jsonFetch<{ partnerId: number; items: RelRow[] }>(
        `/api/partners/${partnerId}/vendor-relationships`,
      ),
    enabled: !!partnerId,
  });
  const items = useMemo(() => data?.items ?? [], [data]);
  const [pending, setPending] = useState<RelRow | null>(null);
  const [diffing, setDiffing] = useState<RelRow | null>(null);

  // Vendors currently on `auto_unapproved` after a catalog/compliance
  // change. Surfaced as a single "re-approve all" affordance so a
  // partner doesn't have to walk through them one at a time.
  const reapproveCandidates = useMemo(
    () => items.filter((r) => r.status === "auto_unapproved"),
    [items],
  );

  const bulkReapprove = useMutation({
    mutationFn: () =>
      jsonFetch<{ partnerId: number; reApproved: number }>(
        `/api/partners/${partnerId}/vendor-relationships/bulk-approve`,
        {
          method: "POST",
          body: JSON.stringify({
            vendorIds: reapproveCandidates.map((r) => r.vendorId),
          }),
        },
      ),
    onSuccess: (r) => {
      toast({
        title: t("approvals.bulkReapproveToast", { count: r.reApproved }),
      });
      qc.invalidateQueries({ queryKey });
    },
    onError: (e: Error) =>
      toast({
        title: translateApiError(e, t, t("approvals.bulkReapproveFailedToast")),
        variant: "destructive",
      }),
  });

  return (
    <Card data-testid="card-partner-vendor-approvals">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />
          {t("approvals.vendorApprovals", { count: items.length })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {canManage && reapproveCandidates.length > 0 ? (
          <div
            className="mb-3 flex items-start gap-2 border rounded-md p-3"
            style={{
              borderColor:
                "color-mix(in srgb, var(--brand-primary) 30%, white)",
              backgroundColor:
                "color-mix(in srgb, var(--brand-primary) 8%, white)",
            }}
            data-testid="banner-bulk-reapprove"
          >
            <AlertTriangle
              className="w-4 h-4 mt-0.5 shrink-0"
              style={{ color: "var(--brand-primary)" }}
            />
            <div className="flex-1 text-sm">
              <div
                className="font-medium"
                style={{ color: "var(--brand-primary)" }}
              >
                {t("approvals.bulkReapproveBannerTitle", {
                  count: reapproveCandidates.length,
                })}
              </div>
              <p
                className="text-xs mt-1"
                style={{
                  color:
                    "color-mix(in srgb, var(--brand-primary) 80%, black)",
                }}
              >
                {t("approvals.bulkReapproveBannerHelp")}
              </p>
            </div>
            <PngPillButton
              color="green"

              className="min-w-[150px]"
              onClick={() => bulkReapprove.mutate()}
              disabled={bulkReapprove.isPending}
              data-testid="button-bulk-reapprove"
            >
              {bulkReapprove.isPending
                ? t("approvals.saving")
                : t("approvals.bulkReapproveAction")}
            </PngPillButton>
          </div>
        ) : null}
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("approvals.noVendorRelationships")}
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((r) => {
              const versionDrift =
                r.status === "approved" &&
                r.approvedCatalogVersionId !== null &&
                r.currentCatalogVersionId !== null &&
                r.approvedCatalogVersionId !== r.currentCatalogVersionId;
              return (
                <div
                  key={r.vendorId}
                  className="border rounded-md p-3 flex items-start gap-3"
                  data-testid={`row-vendor-relationship-${r.vendorId}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/vendors/${r.vendorId}`}
                        className="font-medium text-gray-700 hover:text-[var(--brand-primary)] hover:underline transition-colors"
                      >
                        {r.vendorName}
                      </Link>
                      <StatusBadge status={r.status} />
                      {versionDrift ? (
                        <span
                          className="text-xs text-amber-700"
                          data-testid={`text-version-drift-${r.vendorId}`}
                        >
                          {t("approvals.versionDriftHint")}
                        </span>
                      ) : null}
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
                    {r.lastStatusReason ? (
                      <p
                        className="text-xs text-muted-foreground mt-1"
                        data-testid={`text-last-status-reason-${r.vendorId}`}
                      >
                        {t("approvals.lastReasonLabel")}:{" "}
                        {t(`approvals.reasons.${r.lastStatusReason}`, {
                          defaultValue: r.lastStatusReason,
                        })}
                      </p>
                    ) : null}
                    {r.notes && (
                      <p className="text-xs text-muted-foreground mt-1 italic">
                        "{r.notes}"
                      </p>
                    )}
                    {isAdmin ? (
                      <div className="mt-2">
                        <Link
                          href={`/billing-settings/${r.vendorId}/${partnerId}`}
                          className="text-xs text-gray-700 hover:text-[var(--brand-primary)] hover:underline transition-colors inline-flex items-center gap-1"
                          data-testid={`link-billing-settings-${r.vendorId}`}
                        >
                          <Receipt className="w-3 h-3" />
                          {t("invoices.billingSettings.editLink")}
                        </Link>
                      </div>
                    ) : canManage ? (
                      // Partner admins of this partner org get the same
                      // editor under a partner-side test-id so e2e flows
                      // can target it independently from the admin link.
                      <div className="mt-2">
                        <Link
                          href={`/billing-settings/${r.vendorId}/${partnerId}`}
                          className="text-xs text-gray-700 hover:text-[var(--brand-primary)] hover:underline transition-colors inline-flex items-center gap-1"
                          data-testid={`link-billing-settings-partner-${r.vendorId}`}
                        >
                          <Receipt className="w-3 h-3" />
                          {t("invoices.billingSettings.editLink")}
                        </Link>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    {r.approvedCatalogVersionId &&
                    r.currentCatalogVersionId &&
                    r.approvedCatalogVersionId !==
                      r.currentCatalogVersionId ? (
                      <button
                        type="button"
                        onClick={() => setDiffing(r)}
                        className="text-xs text-gray-700 hover:text-[var(--brand-primary)] hover:underline transition-colors"
                        data-testid={`button-view-diff-${r.vendorId}`}
                      >
                        {t("approvals.viewDiffButton")}
                      </button>
                    ) : null}
                    {canManage && r.status !== "approved" && (
                      <PngPillButton
                        color="green"

                        className="min-w-[120px]"
                        onClick={() => setPending(r)}
                        data-testid={`button-approve-vendor-${r.vendorId}`}
                      >
                        {r.status === "auto_unapproved"
                          ? t("approvals.reapproveButton")
                          : t("approvals.approveButton")}
                      </PngPillButton>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      {pending && (
        <ApproveModal
          partnerId={partnerId}
          vendor={pending}
          open={!!pending}
          onOpenChange={(v) => !v && setPending(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey });
          }}
        />
      )}
      {diffing && (
        <CatalogDiffModal
          vendor={diffing}
          open={!!diffing}
          onOpenChange={(v) => !v && setDiffing(null)}
        />
      )}
    </Card>
  );
}
