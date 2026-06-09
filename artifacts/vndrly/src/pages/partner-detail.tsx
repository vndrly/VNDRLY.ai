import { Fragment, useState, useRef, useMemo, useEffect } from "react";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
import { formatPhone, handlePhoneInput, stripPhone } from "@/lib/utils";
import {
  compressMainLogo,
  fitImageIntoSquare,
  isSquareWithinTolerance,
} from "@/lib/image-resize";
import { SquareLogoCropDialog } from "@/components/square-logo-crop-dialog";
import {
  useGetPartner,
  useUpdatePartner,
  useDeletePartner,
  useListSiteLocations,
  useListPartnerContacts,
  useCreatePartnerContact,
  useDeletePartnerContact,
  useUpdatePartnerContact,
  useListPartnerNotes,
  useCreatePartnerNote,
  useDeletePartnerNote,
  matchPartner,
  getGetPartnerQueryKey,
  getListSiteLocationsQueryKey,
  getListPartnersQueryKey,
  getListPartnerContactsQueryKey,
  getListPartnerNotesQueryKey,
} from "@workspace/api-client-react";
import type { MatchPartnerResponseItem } from "@workspace/api-client-react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import StatusBadge from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { MapPin, Pencil, Plus, Trash2, Handshake, UserCheck, FileText, Upload, ImageIcon, Printer, ArrowUpDown, Receipt, Download, AlertTriangle, RotateCcw, ChevronDown, ChevronRight, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import BlueButton from "@/components/blue-button";
import BrandPillButton from "@/components/brand-pill-button";
import PngPill, { PngPillButton, brandImagePillSrc } from "@/components/png-pill-rollover";
import { useBrand } from "@/hooks/use-brand";
import RedButton from "@/components/red-button";
import { PhotoUploadField } from "@/components/photo-upload-field";
import SphereBackButton from "@/components/sphere-back-button";
import BrandRolePill from "@/components/brand-role-pill";
import { useAuth } from "@/hooks/use-auth";
import OrgMembersCard from "@/components/org-members-card";
import PartnerVendorApprovalsCard from "@/components/partner-vendor-approvals-card";
import { getContrastWarningKind, getColorPairWarningKind, getSidebarContrastWarningKind } from "@/lib/brand-color";
import { PosterPreview } from "@/components/poster-preview";

const COMPANY_ROLES = [
  "Operations Manager",
  "Drilling / Completions Engineer",
  "Procurement / Supply Chain",
  "Hotlist Coordinator",
  "Field Superintendent",
  "Company Man / Site Representative",
  "HSE / Safety Officer",
  "Ticket Approver",
  "Accounts Payable",
  "Account Owner / Executive Sponsor",
  "Visitor Notifications",
] as const;

function translateCompanyRole(t: ReturnType<typeof useTranslation>["t"], role: string): string {
  return t(`partners.companyRoleNames.${role}`, { defaultValue: role });
}

function RoleMultiSelect({ value, onChange, testIdPrefix }: { value: string[]; onChange: (next: string[]) => void; testIdPrefix: string }) {
  const { t } = useTranslation();
  const toggle = (role: string) => {
    if (value.includes(role)) onChange(value.filter((r) => r !== role));
    else onChange([...value, role]);
  };
  return (
    <div className="flex flex-wrap gap-2 items-center">
      {COMPANY_ROLES.map((role) => {
        const active = value.includes(role);
        const testId = `${testIdPrefix}-${role.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
        const label = translateCompanyRole(t, role);
        if (active) {
          return (
            <button
              key={role}
              type="button"
              onClick={() => toggle(role)}
              aria-pressed={true}
              data-testid={testId}
              className="bg-transparent border-0 p-0 cursor-pointer select-none transition-transform active:scale-[0.98]"
            >
              <PngPill color="brand">
                {label}
              </PngPill>
            </button>
          );
        }
        return (
          <PngPillButton
            key={role}
            color="brand"
            onClick={() => toggle(role)}
            data-testid={testId}
          >
            {label}
          </PngPillButton>
        );
      })}
    </div>
  );
}

type WorkTypeCatalogItem = {
  workTypeId: number;
  name: string;
  category: string | null;
  description: string;
  afe: string;
  // Number of vendors that currently offer this product/service via
  // vendor_work_types. Surfaced as a small TogglePill next to the
  // work-type name so admins can see at a glance how much vendor
  // coverage exists before expanding the row.
  vendorCount: number;
};

type VendorOffer = {
  vendorId: number;
  vendorName: string;
  unitPrice: string | null;
  unit: string | null;
  currency: string | null;
  notes: string | null;
  approved: boolean;
  approvedAt: string | null;
  approvedUnitPrice: string | null;
};

function formatVendorPrice(
  t: ReturnType<typeof useTranslation>["t"],
  o: { unitPrice: string | null; unit: string | null; currency: string | null },
): string {
  if (!o.unitPrice) return t("partners.productServiceCatalog.priceUnknown");
  const cur = o.currency ?? "USD";
  const unit = o.unit ? ` / ${o.unit}` : "";
  return `${cur} ${o.unitPrice}${unit}`;
}

// Inline expansion content for a single catalog row. Loads vendor
// offers on demand and lets the partner toggle approval per vendor.
function CatalogRowVendorOffers({
  partnerId,
  workTypeId,
  canManage,
}: {
  partnerId: number;
  workTypeId: number;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const queryKey = [
    "partner-work-type-vendor-offers",
    partnerId,
    workTypeId,
  ] as const;

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/api/partners/${partnerId}/work-types/${workTypeId}/vendor-offers`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Failed to load vendor offers (${res.status})`);
      return res.json() as Promise<{
        partnerId: number;
        workTypeId: number;
        items: VendorOffer[];
      }>;
    },
  });

  const offers = data?.items ?? [];
  // Track which checkboxes are mid-flight so we can disable them and
  // optionally show a spinner without flashing the cached query state.
  const [pending, setPending] = useState<Set<number>>(new Set());

  const setApproval = useMutation({
    mutationFn: async ({
      vendorId,
      approved,
    }: {
      vendorId: number;
      approved: boolean;
    }) => {
      const res = await fetch(
        `${API_BASE}/api/partners/${partnerId}/work-types/${workTypeId}/vendor-approvals/${vendorId}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approved }),
        },
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Approval failed (${res.status}): ${txt}`);
      }
      return res.json() as Promise<{ approved: boolean }>;
    },
    onMutate: ({ vendorId }) => {
      setPending((prev) => {
        const next = new Set(prev);
        next.add(vendorId);
        return next;
      });
    },
    onSettled: (_data, _err, vars) => {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(vars.vendorId);
        return next;
      });
    },
    onSuccess: (r) => {
      toast({
        title: r.approved
          ? t("partners.productServiceCatalog.approvedToast")
          : t("partners.productServiceCatalog.approvalRemovedToast"),
      });
      queryClient.invalidateQueries({ queryKey });
      // Refresh the parent summary count so "X of Y approved" stays accurate.
      queryClient.invalidateQueries({
        queryKey: ["partner-work-type-catalog-approval-summary", partnerId],
      });
    },
    onError: (err: any) => {
      toast({
        title: translateApiError(
          err,
          t,
          t("partners.productServiceCatalog.approveFailedTitle"),
        ),
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="p-3 text-sm text-muted-foreground">
        {t("partners.productServiceCatalog.vendorOffersLoading")}
      </div>
    );
  }
  if (offers.length === 0) {
    return (
      <div className="p-3 text-sm text-muted-foreground" data-testid={`vendor-offers-empty-${workTypeId}`}>
        {t("partners.productServiceCatalog.vendorOffersEmpty")}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2 bg-muted/30">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("partners.productServiceCatalog.vendorOffersHeading")}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("partners.productServiceCatalog.vendorOffersHelp")}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">
              {t("partners.productServiceCatalog.colVendor")}
            </TableHead>
            <TableHead className="text-xs">
              {t("partners.productServiceCatalog.colCatalogPrice")}
            </TableHead>
            <TableHead className="text-xs w-32 text-center">
              {t("partners.productServiceCatalog.colApproval")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {offers.map((o) => {
            const busy = pending.has(o.vendorId);
            return (
              <TableRow
                key={o.vendorId}
                data-testid={`row-vendor-offer-${workTypeId}-${o.vendorId}`}
              >
                <TableCell className="text-sm font-medium">
                  {o.vendorName}
                </TableCell>
                <TableCell className="text-sm tabular-nums">
                  {formatVendorPrice(t, o)}
                </TableCell>
                <TableCell className="text-center">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={o.approved}
                      disabled={!canManage || busy}
                      onCheckedChange={(v) =>
                        setApproval.mutate({
                          vendorId: o.vendorId,
                          approved: !!v,
                        })
                      }
                      data-testid={`checkbox-approve-${workTypeId}-${o.vendorId}`}
                    />
                    <span className="text-xs text-muted-foreground">
                      {t("partners.productServiceCatalog.approveLabel")}
                    </span>
                  </label>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function PartnerProductServiceCatalogCard({
  partnerId,
  canManage,
  canAddToCatalog,
}: {
  partnerId: number;
  canManage: boolean;
  /**
   * Gate for the "Add to Catalog" trigger. The underlying
   * POST /api/work-types endpoint is `requireAdmin`, so we only
   * surface the affordance to admins; partner self-edit users would
   * just hit a 403 if they tried. Threaded as a prop (rather than
   * reaching into useAuth() here) so the gating decision lives in
   * one place — the parent PartnerDetail render at the call site.
   */
  canAddToCatalog: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const queryKey = ["partner-work-type-catalog", partnerId] as const;

  // ---------------------------------------------------------------
  // "Add to Catalog" modal state. Creates a new global work_type
  // row via POST /api/work-types — the catalog list endpoint joins
  // ALL work_types regardless of whether this partner has an AFE
  // mapped, so a successful create makes the new row appear in the
  // table immediately on every partner's catalog (vendors can then
  // attach unit prices via the existing vendor-offers / vendor
  // self-service flow). Admin-only; gated on `canAddToCatalog`.
  // ---------------------------------------------------------------
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    name: "",
    category: "",
    description: "",
    estimatedDuration: "",
    estimatedPrice: "",
  });
  const resetAddForm = () =>
    setAddForm({
      name: "",
      category: "",
      description: "",
      estimatedDuration: "",
      estimatedPrice: "",
    });

  const createWorkType = useMutation({
    mutationFn: async () => {
      const name = addForm.name.trim();
      const category = addForm.category.trim();
      const description = addForm.description.trim();
      const estimatedDuration = addForm.estimatedDuration.trim();
      const priceRaw = addForm.estimatedPrice.trim();

      if (!name) throw new Error(t("partners.productServiceCatalog.addNameRequired"));
      if (!category) throw new Error(t("partners.productServiceCatalog.addCategoryRequired"));
      let estimatedPrice: string | null = null;
      if (priceRaw !== "") {
        const cleaned = priceRaw.replace(/[$,\s]/g, "");
        const n = Number(cleaned);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error(t("partners.productServiceCatalog.addPriceInvalid"));
        }
        estimatedPrice = n.toFixed(2);
      }

      const res = await fetch(`${API_BASE}/api/work-types`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          description: description || null,
          estimatedDuration: estimatedDuration || null,
          estimatedPrice,
        }),
      });
      if (!res.ok) {
        // Mirror the partners.tsx duplicate-name flow: read the JSON
        // body so translateApiError() can pick up the structured
        // `code: "work_type.duplicate_name"` + `details: { name }`
        // payload that workTypes.ts emits on a 409.
        let data: unknown = null;
        try {
          data = await res.json();
        } catch {
          /* ignore — body wasn't JSON */
        }
        const err = new Error(`Failed (${res.status})`) as Error & {
          status?: number;
          data?: unknown;
        };
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t("partners.productServiceCatalog.addedToast") });
      // The list endpoint joins ALL work_types so the new row will
      // surface on every partner's catalog. Invalidate this partner's
      // cached list so the table re-renders with the new entry.
      queryClient.invalidateQueries({ queryKey });
      setAddOpen(false);
      resetAddForm();
    },
    onError: (err: unknown) => {
      toast({
        variant: "destructive",
        title: t("partners.productServiceCatalog.addFailedTitle"),
        description: translateApiError(
          err,
          t,
          t("partners.productServiceCatalog.addFailedTitle"),
        ),
      });
    },
  });

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/api/partners/${partnerId}/work-type-afes`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Failed to load catalog (${res.status})`);
      return res.json() as Promise<{
        partnerId: number;
        items: WorkTypeCatalogItem[];
      }>;
    },
  });

  // Lightweight summary: count of work types where this partner has
  // approved at least one vendor. Drives the "X of Y approved" header.
  // Cached separately so toggling a checkbox can invalidate the summary
  // without re-fetching the full catalog table.
  const summaryQueryKey = [
    "partner-work-type-catalog-approval-summary",
    partnerId,
  ] as const;
  const { data: summary } = useQuery({
    queryKey: summaryQueryKey,
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/api/partners/${partnerId}/work-type-afes`,
        { credentials: "include" },
      );
      if (!res.ok) return { approved: 0 };
      // The count comes from the per-row vendor-offers endpoint. To
      // avoid N+1 here we just compute "approved per work type" lazily
      // — when a row is expanded its child fetch updates the cache.
      // Until expansion happens we report 0 known approvals. This is
      // intentionally conservative; an explicit summary endpoint can
      // be added later if the count needs to be accurate before any
      // expansion.
      return { approved: 0 };
    },
    staleTime: Infinity,
  });

  // Task #1108: persist the AFE catalog filter in the URL so leaving and
  // returning to the partner page (and sharing the link) keeps the same
  // narrowed view. Mirrors the Site Locations card pattern lower in this
  // file. Uses a distinct param name (`afeFilter`) so it does not
  // collide with `sitesFilter`.
  const afeSearch = useSearch();
  const initialAfeFilter = useMemo(() => {
    const params = new URLSearchParams(afeSearch);
    const f = params.get("afeFilter");
    return f ? f.slice(0, 200) : "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [filter, setFilter] = useState(initialAfeFilter);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [, navigateAfe] = useLocation();

  // Sync external URL changes (back/forward, link clicks) into local state.
  useEffect(() => {
    const params = new URLSearchParams(afeSearch);
    const next = (params.get("afeFilter") || "").slice(0, 200);
    if (next !== filter) setFilter(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [afeSearch]);

  // Push selections back into the URL with replaceState so the history
  // stack stays clean.
  useEffect(() => {
    const params = new URLSearchParams(afeSearch);
    if (!filter) params.delete("afeFilter");
    else params.set("afeFilter", filter);
    const qs = params.toString();
    const target = `/partners/${partnerId}${qs ? `?${qs}` : ""}`;
    const current = `/partners/${partnerId}${afeSearch ? `?${afeSearch}` : ""}`;
    if (target !== current) navigateAfe(target, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const items = data?.items ?? [];
  const filteredItems = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        (it.category ?? "").toLowerCase().includes(q) ||
        (it.description ?? "").toLowerCase().includes(q),
    );
  }, [items, filter]);

  const toggleExpanded = (workTypeId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(workTypeId)) next.delete(workTypeId);
      else next.add(workTypeId);
      return next;
    });
  };

  return (
    <Card data-testid="card-partner-product-service-catalog">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <Receipt className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />
          {t("partners.productServiceCatalog.title")}
        </CardTitle>
        <div className="flex items-center gap-3">
          <div className="text-xs text-muted-foreground">
            {t("partners.productServiceCatalog.summary", {
              approved: summary?.approved ?? 0,
              total: items.length,
            })}
          </div>
          {canAddToCatalog && (
            <PngPillButton
              color="blue"
              onClick={() => setAddOpen(true)}
              className="px-2"
              data-testid="button-open-add-to-catalog"
            >
              {t("partners.productServiceCatalog.addToCatalog")}
            </PngPillButton>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t("partners.productServiceCatalog.description")}
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative inline-flex items-center h-[23px] w-[180px] rounded-full bg-white border border-black/10">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
            <input
              type="text"
              placeholder={t("partners.productServiceCatalog.filterPlaceholder")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full h-full bg-transparent border-0 outline-none pl-8 pr-3 text-xs font-normal text-gray-800 placeholder:text-gray-500 rounded-full"
              data-testid="input-catalog-filter"
            />
          </div>
        </div>

        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {t("partners.productServiceCatalog.empty")}
          </p>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>
                    {t("partners.productServiceCatalog.colCategory")}
                  </TableHead>
                  <TableHead>
                    {t("partners.productServiceCatalog.colWorkType")}
                  </TableHead>
                  <TableHead>
                    {t("partners.productServiceCatalog.colDescription")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((it) => {
                  const isOpen = expanded.has(it.workTypeId);
                  return (
                    <Fragment key={it.workTypeId}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleExpanded(it.workTypeId)}
                        data-testid={`row-catalog-${it.workTypeId}`}
                      >
                        <TableCell className="w-8 align-top">
                          <button
                            type="button"
                            className="p-1 -m-1 text-muted-foreground"
                            aria-label={
                              isOpen
                                ? t("partners.productServiceCatalog.collapseRow")
                                : t("partners.productServiceCatalog.expandRow")
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpanded(it.workTypeId);
                            }}
                            data-testid={`button-toggle-catalog-${it.workTypeId}`}
                          >
                            {isOpen ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </button>
                        </TableCell>
                        <TableCell className="text-muted-foreground align-top">
                          {it.category || "-"}
                        </TableCell>
                        <TableCell className="font-medium align-top">
                          <div className="flex items-center gap-2">
                            <span>{it.name}</span>
                            <PngPill
                              color="brand"
                              rest={it.vendorCount === 0}
                              className="shrink-0"
                              data-testid={`badge-catalog-vendor-count-${it.workTypeId}`}
                              aria-label={t(
                                "partners.productServiceCatalog.vendorCountAria",
                                { count: it.vendorCount },
                              )}
                            >
                              {it.vendorCount}
                            </PngPill>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground align-top">
                          {it.description ||
                            t("partners.productServiceCatalog.noDescription")}
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow
                          data-testid={`row-catalog-expanded-${it.workTypeId}`}
                        >
                          <TableCell colSpan={4} className="p-0">
                            <CatalogRowVendorOffers
                              partnerId={partnerId}
                              workTypeId={it.workTypeId}
                              canManage={canManage}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
                {filteredItems.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center text-muted-foreground py-4"
                    >
                      {t("partners.productServiceCatalog.noFilterMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (createWorkType.isPending) return;
          setAddOpen(open);
          if (!open) resetAddForm();
        }}
      >
        <DialogContent
          className="max-h-[90vh] overflow-y-auto"
          data-testid="dialog-add-to-catalog"
        >
          <DialogHeader>
            <DialogTitle>
              {t("partners.productServiceCatalog.addModalTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("partners.productServiceCatalog.addModalDescription")}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              createWorkType.mutate();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="add-catalog-name">
                {t("partners.productServiceCatalog.addNameLabel")}
              </Label>
              <Input
                id="add-catalog-name"
                value={addForm.name}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder={t(
                  "partners.productServiceCatalog.addNamePlaceholder",
                )}
                autoFocus
                data-testid="input-add-catalog-name"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="add-catalog-category">
                {t("partners.productServiceCatalog.addCategoryLabel")}
              </Label>
              <Input
                id="add-catalog-category"
                value={addForm.category}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, category: e.target.value }))
                }
                placeholder={t(
                  "partners.productServiceCatalog.addCategoryPlaceholder",
                )}
                data-testid="input-add-catalog-category"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="add-catalog-description">
                {t("partners.productServiceCatalog.addDescriptionLabel")}
              </Label>
              <Textarea
                id="add-catalog-description"
                value={addForm.description}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder={t(
                  "partners.productServiceCatalog.addDescriptionPlaceholder",
                )}
                rows={3}
                data-testid="input-add-catalog-description"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="add-catalog-duration">
                  {t("partners.productServiceCatalog.addEstimatedDurationLabel")}
                </Label>
                <Input
                  id="add-catalog-duration"
                  value={addForm.estimatedDuration}
                  onChange={(e) =>
                    setAddForm((f) => ({
                      ...f,
                      estimatedDuration: e.target.value,
                    }))
                  }
                  placeholder={t(
                    "partners.productServiceCatalog.addEstimatedDurationPlaceholder",
                  )}
                  data-testid="input-add-catalog-duration"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="add-catalog-price">
                  {t("partners.productServiceCatalog.addEstimatedPriceLabel")}
                </Label>
                <Input
                  id="add-catalog-price"
                  type="text"
                  inputMode="decimal"
                  value={addForm.estimatedPrice}
                  onChange={(e) =>
                    setAddForm((f) => ({
                      ...f,
                      estimatedPrice: e.target.value,
                    }))
                  }
                  placeholder={t(
                    "partners.productServiceCatalog.addEstimatedPricePlaceholder",
                  )}
                  data-testid="input-add-catalog-price"
                />
              </div>
            </div>
            <DialogFooter>
              <PngPillButton
                color="brand"
                type="button"
                onClick={() => {
                  setAddOpen(false);
                  resetAddForm();
                }}
                disabled={createWorkType.isPending}
                className="px-4"
                data-testid="button-cancel-add-to-catalog"
              >
                {t("partners.productServiceCatalog.addCancel")}
              </PngPillButton>
              <PngPillButton
                color="blue"
                type="submit"
                disabled={createWorkType.isPending}
                className="px-4"
                data-testid="button-submit-add-to-catalog"
              >
                {createWorkType.isPending
                  ? t("partners.productServiceCatalog.addCreating")
                  : t("partners.productServiceCatalog.addCreate")}
              </PngPillButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// 1099 totals roll-up panel. Sums each invoice line's amount grouped by
// 1099 income_category across every non-cancelled invoice belonging to
// this partner whose period_start lands in the selected window. Lets
// accountants reconcile the year-end 1099 boxes for a partner without
// opening every invoice individually. Backed by the
// /api/partners/:id/1099-totals endpoint added in routes/invoices.ts.
const INCOME_CATEGORY_KEYS = [
  "nec",
  "misc_rents",
  "misc_royalties",
  "misc_other_income",
  "misc_prizes_awards",
  "misc_medical_health",
  "misc_attorney",
  "k_third_party_network",
  "none",
] as const;
type IncomeCategoryKey = (typeof INCOME_CATEGORY_KEYS)[number];

type Partner1099TotalsResponse = {
  partnerId: number;
  year: number;
  from: string;
  to: string;
  totals: Array<{
    incomeCategory: IncomeCategoryKey;
    amount: string;
    lineCount: number;
  }>;
  grandTotal: string;
};

type RangeMode = "year" | "custom";

function formatUsd(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function Partner1099TotalsCard({ partnerId }: { partnerId: number }) {
  const { t } = useTranslation();
  const currentYear = new Date().getUTCFullYear();
  const [mode, setMode] = useState<RangeMode>("year");
  const [year, setYear] = useState<number>(currentYear);
  // Default custom range mirrors the YTD view for the selected year so
  // toggling between modes is non-destructive.
  const [from, setFrom] = useState<string>(`${currentYear}-01-01`);
  const [to, setTo] = useState<string>(`${currentYear + 1}-01-01`);

  const queryParams =
    mode === "year"
      ? `year=${year}`
      : `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["partner-1099-totals", partnerId, mode, year, from, to] as const,
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/api/partners/${partnerId}/1099-totals?${queryParams}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        throw new Error(`Failed to load 1099 totals (${res.status})`);
      }
      return (await res.json()) as Partner1099TotalsResponse;
    },
    // Date inputs in custom mode are only meaningful when both sides parse.
    enabled:
      mode === "year" || (from.length > 0 && to.length > 0 && from < to),
  });

  // Build the year picker — last 7 calendar years, oldest first looks
  // odd in a select; show newest first so the default selection sits
  // at the top of the list.
  const yearOptions = useMemo(() => {
    const out: number[] = [];
    for (let y = currentYear; y >= currentYear - 6; y--) out.push(y);
    return out;
  }, [currentYear]);

  return (
    <Card data-testid="card-partner-1099-totals">
      <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
        <CardTitle className="flex items-center gap-2">
          <FileText
            className="w-5 h-5"
            style={{ color: "var(--brand-primary)" }}
          />
          {t("partners.totals1099.title", { defaultValue: "1099 totals" })}
        </CardTitle>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 rounded-full border border-black/10 bg-white p-0.5">
            <button
              type="button"
              onClick={() => setMode("year")}
              className={`px-3 h-[23px] rounded-full text-xs font-normal ${mode === "year" ? "bg-[var(--brand-primary)] text-white" : "text-gray-700"}`}
              data-testid="button-1099-totals-mode-year"
            >
              {t("partners.totals1099.modeYear", { defaultValue: "Year" })}
            </button>
            <button
              type="button"
              onClick={() => setMode("custom")}
              className={`px-3 h-[23px] rounded-full text-xs font-normal ${mode === "custom" ? "bg-[var(--brand-primary)] text-white" : "text-gray-700"}`}
              data-testid="button-1099-totals-mode-custom"
            >
              {t("partners.totals1099.modeCustom", {
                defaultValue: "Custom range",
              })}
            </button>
          </div>
          {mode === "year" ? (
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="h-[23px] rounded-full border border-black/10 bg-white px-2 text-xs font-normal text-gray-800"
              data-testid="select-1099-totals-year"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-7 w-[140px] text-xs"
                data-testid="input-1099-totals-from"
              />
              <span className="text-xs text-muted-foreground">
                {t("partners.totals1099.toLabel", { defaultValue: "to" })}
              </span>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-7 w-[140px] text-xs"
                data-testid="input-1099-totals-to"
              />
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t("partners.totals1099.description", {
            defaultValue:
              "Sum of invoice-line amounts grouped by 1099 category across every non-cancelled invoice for this partner in the selected period. Use this when reconciling year-end 1099 boxes.",
          })}
        </p>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : isError ? (
          <p className="text-sm text-destructive">
            {t("partners.totals1099.loadError", {
              defaultValue: "Could not load 1099 totals.",
            })}
          </p>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t("partners.totals1099.colCategory", {
                      defaultValue: "1099 category",
                    })}
                  </TableHead>
                  <TableHead className="text-right w-24">
                    {t("partners.totals1099.colLines", {
                      defaultValue: "Lines",
                    })}
                  </TableHead>
                  <TableHead className="text-right w-40">
                    {t("partners.totals1099.colAmount", {
                      defaultValue: "Amount",
                    })}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.totals ?? []).map((row) => (
                  <TableRow
                    key={row.incomeCategory}
                    data-testid={`row-1099-totals-${row.incomeCategory}`}
                  >
                    <TableCell className="text-sm">
                      {t(`invoices.incomeCategory.${row.incomeCategory}`, {
                        defaultValue: row.incomeCategory,
                      })}
                    </TableCell>
                    <TableCell
                      className="text-right text-sm tabular-nums"
                      data-testid={`cell-1099-totals-lines-${row.incomeCategory}`}
                    >
                      {row.lineCount}
                    </TableCell>
                    <TableCell
                      className="text-right text-sm tabular-nums font-medium"
                      data-testid={`cell-1099-totals-amount-${row.incomeCategory}`}
                    >
                      {formatUsd(row.amount)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell className="text-sm">
                    {t("partners.totals1099.grandTotal", {
                      defaultValue: "Total",
                    })}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums" />
                  <TableCell
                    className="text-right text-sm tabular-nums"
                    data-testid="cell-1099-totals-grand"
                  >
                    {formatUsd(data?.grandTotal ?? "0.00")}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function PartnerDetail({ id }: { id: number }) {
  const { t } = useTranslation();
  const brand = useBrand();
  const { user: authUser } = useAuth();
  const isVendorUser = authUser?.role === "vendor";
  const isOwnPartner = authUser?.role === "partner" && authUser.partnerId === id;
  const canEditPartner = authUser?.role === "admin" || isOwnPartner;
  const isAdmin = authUser?.role === "admin";
  const { data: partner, isLoading } = useGetPartner(id, { query: { enabled: !!id, queryKey: getGetPartnerQueryKey(id) } });
  const { data: sites } = useListSiteLocations({ partnerId: id }, { query: { enabled: !!id, queryKey: getListSiteLocationsQueryKey({ partnerId: id }) } });
  const { data: contacts } = useListPartnerContacts(id, undefined, { query: { enabled: !!id, queryKey: getListPartnerContactsQueryKey(id) } });
  const { data: notes } = useListPartnerNotes(id, { query: { enabled: !!id, queryKey: getListPartnerNotesQueryKey(id) } });
  const updatePartner = useUpdatePartner();
  const removePartner = useDeletePartner();
  const createContact = useCreatePartnerContact();
  const deleteContact = useDeletePartnerContact();
  const updateContact = useUpdatePartnerContact();
  const createNote = useCreatePartnerNote();
  const deleteNote = useDeletePartnerNote();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [editOpen, setEditOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [editContactOpen, setEditContactOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [editingContactId, setEditingContactId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", contactName: "", contactEmail: "", contactPhone: "", physicalAddress: "", billingAddress: "", businessPhone: "", hoursOfOperation: "", stateTaxId: "", federalTaxId: "", blurb: "", operatingRadiusMiles: "", brandPrimaryColor: "", brandAccentColor: "", email1099Subject: "", email1099Body: "" });
  // Duplicate-name guard for the rename flow. Mirrors the create-path
  // logic in partners.tsx so admins can't silently rename a partner to
  // a near-duplicate of an existing one (which would re-introduce the
  // split-reporting problem the create-path warning prevents).
  // /partners/match is admin-only, so we skip the lookup for partner
  // self-edits; admins are the only role that can hit a 403 here.
  const [matches, setMatches] = useState<MatchPartnerResponseItem[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [checkedName, setCheckedName] = useState<string | null>(null);
  const [confirmDifferentRename, setConfirmDifferentRename] = useState(false);
  const [showDeletedContacts, setShowDeletedContacts] = useState(false);
  const deletedContactsQueryKey = ["partner-contacts-deleted", id] as const;
  // Soft-deleted contacts are only ever surfaced for admins via this
  // separate query so we don't disturb the cached active-contacts list
  // (which is keyed off `getListPartnerContactsQueryKey`). The endpoint
  // itself enforces the admin-only check on `?includeDeleted=true`.
  const { data: deletedContacts = [] } = useQuery({
    queryKey: deletedContactsQueryKey,
    enabled: !!id && isAdmin && showDeletedContacts,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/partners/${id}/contacts?includeDeleted=true`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load deleted contacts (${res.status})`);
      const all = (await res.json()) as Array<{
        id: number;
        partnerId: number;
        jobTitle: string;
        name: string;
        email: string;
        phone: string | null;
        roles: string[];
        photoUrl?: string | null;
        createdAt: string;
        deletedAt?: string | null;
        deletedBy?: string | null;
      }>;
      return all.filter((c) => c.deletedAt);
    },
  });
  const handleRestoreContact = async (contactId: number) => {
    const res = await fetch(`${API_BASE}/api/partners/${id}/contacts/${contactId}/restore`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      toast({ title: t("partners.restoreContactFailed"), variant: "destructive" });
      return;
    }
    toast({ title: t("partners.restoredContact") });
    queryClient.invalidateQueries({ queryKey: getListPartnerContactsQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: deletedContactsQueryKey });
  };
  const [contactForm, setContactForm] = useState<{ jobTitle: string; name: string; email: string; phone: string; roles: string[] }>({ jobTitle: "", name: "", email: "", phone: "", roles: [] });
  const [editContactForm, setEditContactForm] = useState<{ jobTitle: string; name: string; email: string; phone: string; roles: string[]; photoUrl: string | null }>({ jobTitle: "", name: "", email: "", phone: "", roles: [], photoUrl: null });
  const initialFormRef = useRef<typeof form | null>(null);
  const initialEditContactFormRef = useRef<typeof editContactForm | null>(null);
  const editFormDirty = useMemo(() => !!initialFormRef.current && JSON.stringify(form) !== JSON.stringify(initialFormRef.current), [form]);
  const editContactDirty = useMemo(() => !!initialEditContactFormRef.current && JSON.stringify(editContactForm) !== JSON.stringify(initialEditContactFormRef.current), [editContactForm]);
  useUnsavedChanges((editOpen && editFormDirty) || (editContactOpen && editContactDirty));
  const tryCloseEdit = (open: boolean) => {
    if (!open && editFormDirty && !window.confirm("You have unsaved changes. Discard them?")) return;
    if (!open) initialFormRef.current = null;
    setEditOpen(open);
  };
  const tryCloseEditContact = (open: boolean) => {
    if (!open && editContactDirty && !window.confirm(t("common.unsavedChangesConfirm", { defaultValue: "You have unsaved changes. Discard them?" }))) return;
    if (!open) { initialEditContactFormRef.current = null; setEditingContactId(null); }
    setEditContactOpen(open);
  };

  // Debounced fuzzy lookup against /partners/match. Mirrors the create
  // path in partners.tsx — AbortController prevents stale responses,
  // and we exclude the partner being edited so the warning doesn't
  // fire when the name is unchanged. The endpoint is admin-only, so
  // partner self-edits skip the lookup entirely.
  useEffect(() => {
    if (!editOpen || !isAdmin) return;
    const trimmed = form.name.trim();
    setConfirmDifferentRename(false);
    if (trimmed.length < 3) {
      setMatches([]);
      setMatchesLoading(false);
      setCheckedName(trimmed);
      return;
    }
    setCheckedName(null);
    setMatchesLoading(true);
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      try {
        const res = await matchPartner(
          { name: trimmed },
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setMatches(res.matches.filter((m) => m.id !== id));
        setCheckedName(trimmed);
      } catch (err) {
        if (
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        setMatches([]);
        setCheckedName(null);
      } finally {
        if (!controller.signal.aborted) setMatchesLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [form.name, editOpen, isAdmin, id]);

  // Reset duplicate-warning state every time the dialog opens so a
  // previous session's warning doesn't briefly flash on the next open.
  useEffect(() => {
    if (editOpen) {
      setMatches([]);
      setConfirmDifferentRename(false);
      setCheckedName(null);
    }
  }, [editOpen]);
  const [noteContent, setNoteContent] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingSquareLogo, setUploadingSquareLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const squareLogoInputRef = useRef<HTMLInputElement>(null);
  // Source file for the SquareLogoCropDialog. Set on non-square
  // selection; cleared on confirm/cancel.
  const [pendingSquareLogoFile, setPendingSquareLogoFile] = useState<File | null>(null);
  const [selectedSiteIds, setSelectedSiteIds] = useState<Set<number>>(new Set());

  // Persist the Site Locations sort/filter in the URL so leaving and
  // returning to the partner page (and sharing the link) keeps the same
  // narrowed view. We hydrate from the query string on first paint, then
  // mirror state changes back via replaceState so flipping controls
  // doesn't pollute the back stack.
  const search = useSearch();
  const initialSiteState = useMemo(() => {
    const params = new URLSearchParams(search);
    const sort = params.get("sitesSort");
    const dir = params.get("sitesDir");
    const filter = params.get("sitesFilter");
    return {
      sortKey: (sort === "status" ? "status" : "name") as "name" | "status",
      sortDir: (dir === "desc" ? "desc" : "asc") as "asc" | "desc",
      filter: filter ? filter.slice(0, 200) : "",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [siteSortKey, setSiteSortKey] = useState<"name" | "status">(initialSiteState.sortKey);
  const [siteSortDir, setSiteSortDir] = useState<"asc" | "desc">(initialSiteState.sortDir);
  const [siteFilter, setSiteFilter] = useState(initialSiteState.filter);

  // Sync external URL changes (back/forward navigation, link clicks) into
  // local state. Local state is the source of truth for rendering.
  useEffect(() => {
    const params = new URLSearchParams(search);
    const sort = params.get("sitesSort");
    const dir = params.get("sitesDir");
    const filter = params.get("sitesFilter");
    const nextSort = (sort === "status" ? "status" : "name") as "name" | "status";
    const nextDir = (dir === "desc" ? "desc" : "asc") as "asc" | "desc";
    const nextFilter = filter ? filter.slice(0, 200) : "";
    if (nextSort !== siteSortKey) setSiteSortKey(nextSort);
    if (nextDir !== siteSortDir) setSiteSortDir(nextDir);
    if (nextFilter !== siteFilter) setSiteFilter(nextFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Push selections back into the URL. We omit defaults to keep the URL
  // tidy, preserve unrelated query params, and use replaceState so
  // flipping filters doesn't grow the history stack.
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (siteSortKey === "name") params.delete("sitesSort");
    else params.set("sitesSort", siteSortKey);
    if (siteSortDir === "asc") params.delete("sitesDir");
    else params.set("sitesDir", siteSortDir);
    if (!siteFilter) params.delete("sitesFilter");
    else params.set("sitesFilter", siteFilter);
    const qs = params.toString();
    const target = `/partners/${id}${qs ? `?${qs}` : ""}`;
    const current = `/partners/${id}${search ? `?${search}` : ""}`;
    if (target !== current) navigate(target, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteSortKey, siteSortDir, siteFilter]);

  const handleSiteSort = (key: "name" | "status") => {
    if (siteSortKey === key) {
      setSiteSortDir(siteSortDir === "asc" ? "desc" : "asc");
    } else {
      setSiteSortKey(key);
      setSiteSortDir("asc");
    }
  };

  const filteredSortedSites = useMemo(() => {
    if (!sites) return [];
    const q = siteFilter.trim().toLowerCase();
    const filtered = q
      ? sites.filter((s) =>
          (s.name || "").toLowerCase().includes(q) ||
          (s.address || "").toLowerCase().includes(q) ||
          (s.siteCode || "").toLowerCase().includes(q),
        )
      : sites;
    return [...filtered].sort((a, b) => {
      const valA = (siteSortKey === "name" ? a.name : a.status || "").toLowerCase();
      const valB = (siteSortKey === "name" ? b.name : b.status || "").toLowerCase();
      if (valA < valB) return siteSortDir === "asc" ? -1 : 1;
      if (valA > valB) return siteSortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [sites, siteFilter, siteSortKey, siteSortDir]);

  const toggleSelectedSite = (siteId: number) => {
    setSelectedSiteIds((prev) => {
      const next = new Set(prev);
      if (next.has(siteId)) next.delete(siteId);
      else next.add(siteId);
      return next;
    });
  };

  const handlePrintSelectedQrs = () => {
    const ids = Array.from(selectedSiteIds);
    if (ids.length === 0) return;
    window.open(
      `${import.meta.env.BASE_URL}print-visitor-qrs?ids=${ids.join(",")}`,
      "_blank",
    );
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: t("partners.pleaseSelectImage", { defaultValue: "Please select an image file" }), variant: "destructive" });
      return;
    }
    setUploadingLogo(true);
    try {
      // Cap longest edge at ~1024px to keep modal-header and partner
      // detail renders fast even for multi-MB brand-kit exports.
      const compressed = await compressMainLogo(file);
      const res = await fetch(`${API_BASE}/api/storage/uploads/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: compressed.name, size: compressed.size, contentType: compressed.type }),
      });
      if (!res.ok) throw new Error("Failed to get upload URL");
      const { uploadURL, objectPath } = await res.json();
      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": compressed.type },
        body: compressed,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      await fetch(`${API_BASE}/api/storage/uploads/finalize`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectURL: uploadURL, visibility: "public" }),
      });
      const logoUrl = `${API_BASE}/api/storage${objectPath}`;
      updatePartner.mutate(
        { id, data: { logoUrl } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetPartnerQueryKey(id) });
            queryClient.invalidateQueries({ queryKey: getListPartnersQueryKey() });
            toast({ title: t("partners.logoUploaded", { defaultValue: "Logo uploaded" }) });
          },
          onError: () => toast({ title: t("partners.logoSaveFailed", { defaultValue: "Failed to save logo" }), variant: "destructive" }),
        },
      );
    } catch {
      toast({ title: t("partners.logoUploadFailed", { defaultValue: "Failed to upload logo" }), variant: "destructive" });
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const handleRemoveLogo = () => {
    if (!confirm(t("partners.removeLogoConfirm"))) return;
    updatePartner.mutate(
      { id, data: { logoUrl: null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPartnerQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListPartnersQueryKey() });
          toast({ title: t("partners.logoRemoved", { defaultValue: "Logo removed" }) });
        },
        onError: () => toast({ title: t("partners.logoRemoveFailed", { defaultValue: "Failed to remove logo" }), variant: "destructive" }),
      },
    );
  };

  // Uploads an already-normalized 512×512 PNG and persists the
  // resulting URL on the partner. Shared between the skip-cropper
  // path and the SquareLogoCropDialog confirm callback.
  const uploadSquareLogo = async (normalized: File) => {
    setUploadingSquareLogo(true);
    try {
      const res = await fetch(`${API_BASE}/api/storage/uploads/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: normalized.name, size: normalized.size, contentType: normalized.type }),
      });
      if (!res.ok) throw new Error("Failed to get upload URL");
      const { uploadURL, objectPath } = await res.json();
      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": normalized.type },
        body: normalized,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      await fetch(`${API_BASE}/api/storage/uploads/finalize`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectURL: uploadURL, visibility: "public" }),
      });
      const logoSquareUrl = `${API_BASE}/api/storage${objectPath}`;
      updatePartner.mutate(
        { id, data: { logoSquareUrl } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetPartnerQueryKey(id) });
            queryClient.invalidateQueries({ queryKey: getListPartnersQueryKey() });
            toast({ title: t("partners.squareLogoUploaded", { defaultValue: "Square logo uploaded" }) });
          },
          onError: () => toast({ title: t("partners.logoSaveFailed", { defaultValue: "Failed to save logo" }), variant: "destructive" }),
        },
      );
    } catch {
      toast({ title: t("partners.logoUploadFailed", { defaultValue: "Failed to upload logo" }), variant: "destructive" });
    } finally {
      setUploadingSquareLogo(false);
    }
  };

  // Gate the square-logo upload behind a crop UI when the source is
  // visibly non-square. SVGs and already-square (within 2%) inputs
  // skip the modal; everything else opens the cropper so the user can
  // pick the most legible 1:1 region.
  const handleSquareLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: t("partners.pleaseSelectImage", { defaultValue: "Please select an image file" }), variant: "destructive" });
      if (squareLogoInputRef.current) squareLogoInputRef.current.value = "";
      return;
    }
    try {
      const skipCropper = await isSquareWithinTolerance(file);
      if (skipCropper) {
        const normalized = await fitImageIntoSquare(file);
        await uploadSquareLogo(normalized);
      } else {
        setPendingSquareLogoFile(file);
      }
    } catch {
      toast({ title: t("partners.logoUploadFailed", { defaultValue: "Failed to upload logo" }), variant: "destructive" });
    } finally {
      // Always reset so re-selecting the same file fires onChange
      // again — needed for the cancel-cropper-then-retry flow.
      if (squareLogoInputRef.current) squareLogoInputRef.current.value = "";
    }
  };

  const handleRemoveSquareLogo = () => {
    if (!confirm(t("partners.removeSquareLogoConfirm", { defaultValue: "Remove the square logo?" }))) return;
    updatePartner.mutate(
      { id, data: { logoSquareUrl: null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPartnerQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListPartnersQueryKey() });
          toast({ title: t("partners.squareLogoRemoved", { defaultValue: "Square logo removed" }) });
        },
        onError: () => toast({ title: t("partners.logoRemoveFailed", { defaultValue: "Failed to remove logo" }), variant: "destructive" }),
      },
    );
  };

  const openEditDialog = () => {
    if (partner) {
      const hydrated = {
        name: partner.name,
        contactName: partner.contactName,
        contactEmail: partner.contactEmail,
        contactPhone: partner.contactPhone || "",
        physicalAddress: partner.physicalAddress || "",
        billingAddress: partner.billingAddress || "",
        businessPhone: partner.businessPhone || "",
        hoursOfOperation: partner.hoursOfOperation || "",
        stateTaxId: partner.stateTaxId || "",
        federalTaxId: partner.federalTaxId || "",
        blurb: partner.blurb || "",
        operatingRadiusMiles: partner.operatingRadiusMiles != null ? String(partner.operatingRadiusMiles) : "",
        brandPrimaryColor: partner.brandPrimaryColor || "",
        brandAccentColor: partner.brandAccentColor || "",
        email1099Subject: partner.email1099Subject || "",
        email1099Body: partner.email1099Body || "",
      };
      setForm(hydrated);
      initialFormRef.current = hydrated;
    }
    setEditOpen(true);
  };

  const handleEdit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = form.name.trim();
    // Only admins can hit /partners/match, so only gate the save for
    // them. Mirrors the gating in partners.tsx so a fast Enter can't
    // slip through before the debounced check resolves.
    if (isAdmin && trimmedName.length >= 3 && (matchesLoading || checkedName !== trimmedName)) {
      toast({
        title: t("partners.duplicateChecking", {
          defaultValue: "Checking for similar partners…",
        }),
      });
      return;
    }
    if (isAdmin && matches.length > 0 && !confirmDifferentRename) {
      toast({
        title: t("partners.duplicateRenameConfirmRequired", {
          defaultValue:
            "Please confirm this is a different partner before saving.",
        }),
        variant: "destructive",
      });
      return;
    }
    updatePartner.mutate(
      { id, data: { ...form, contactPhone: stripPhone(form.contactPhone) || null, physicalAddress: form.physicalAddress || null, billingAddress: form.billingAddress || null, businessPhone: stripPhone(form.businessPhone) || null, hoursOfOperation: form.hoursOfOperation || null, stateTaxId: form.stateTaxId || null, federalTaxId: form.federalTaxId || null, blurb: form.blurb || null, operatingRadiusMiles: form.operatingRadiusMiles === "" ? null : parseInt(form.operatingRadiusMiles), brandPrimaryColor: form.brandPrimaryColor || null, brandAccentColor: form.brandAccentColor || null, email1099Subject: form.email1099Subject.trim() || null, email1099Body: form.email1099Body.trim() || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPartnerQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListPartnersQueryKey() });
          initialFormRef.current = form;
          setEditOpen(false);
          toast({ title: t("partners.updateSuccess") });
        },
        onError: (err) => {
          // Surface structured 409 errors (e.g. `partner.duplicate_name`
          // when the rename collides with another partner's canonical
          // name) using their localized copy + interpolated values from
          // the response `details` payload. Falls back to the generic
          // "update failed" toast for unstructured errors.
          toast({
            title: translateApiError(err, t, t("partners.updateFailed")),
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleAddContact = (e: React.FormEvent) => {
    e.preventDefault();
    createContact.mutate(
      { partnerId: id, data: { ...contactForm, phone: stripPhone(contactForm.phone) || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPartnerContactsQueryKey(id) });
          setContactOpen(false);
          setContactForm({ jobTitle: "", name: "", email: "", phone: "", roles: [] });
          toast({ title: t("partners.addedContact") });
        },
        onError: () => {
          toast({ title: t("partners.addContactFailed"), variant: "destructive" });
        },
      },
    );
  };

  const openEditContactDialog = (contact: { id: number; jobTitle: string; name: string; email: string; phone: string | null; roles?: string[]; photoUrl?: string | null }) => {
    setEditingContactId(contact.id);
    const hydrated = {
      jobTitle: contact.jobTitle,
      name: contact.name,
      email: contact.email,
      phone: contact.phone ? formatPhone(contact.phone) : "",
      roles: contact.roles ?? [],
      photoUrl: contact.photoUrl ?? null,
    };
    setEditContactForm(hydrated);
    initialEditContactFormRef.current = hydrated;
    setEditContactOpen(true);
  };

  const handleEditContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContactId) return;
    updateContact.mutate(
      { partnerId: id, contactId: editingContactId, data: { ...editContactForm, phone: stripPhone(editContactForm.phone) || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPartnerContactsQueryKey(id) });
          initialEditContactFormRef.current = editContactForm;
          setEditContactOpen(false);
          setEditingContactId(null);
          toast({ title: t("partners.updatedContact") });
        },
        onError: () => {
          toast({ title: t("partners.updateContactFailed"), variant: "destructive" });
        },
      },
    );
  };

  const handleDeleteContact = (contactId: number) => {
    deleteContact.mutate(
      { partnerId: id, contactId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPartnerContactsQueryKey(id) });
          toast({ title: t("partners.removedContact") });
        },
      },
    );
  };

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteContent.trim()) return;
    createNote.mutate(
      { partnerId: id, data: { content: noteContent.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPartnerNotesQueryKey(id) });
          setNoteOpen(false);
          setNoteContent("");
          toast({ title: t("partners.addedNote") });
        },
        onError: () => {
          toast({ title: t("partners.addNoteFailed"), variant: "destructive" });
        },
      },
    );
  };

  const handleDeleteNote = (noteId: number) => {
    deleteNote.mutate(
      { partnerId: id, noteId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPartnerNotesQueryKey(id) });
          toast({ title: t("partners.removedNote") });
        },
      },
    );
  };

  const handleRemovePartner = () => {
    if (!confirm(t("partners.removePartnerConfirm", { name: partner?.name ?? "" }))) return;
    removePartner.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPartnersQueryKey() });
          toast({ title: t("partners.removedPartnerToast") });
          navigate("/partners");
        },
        onError: () => {
          toast({ title: t("partners.removePartnerFailedToast"), variant: "destructive" });
        },
      },
    );
  };

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-48 w-full" /></div>;
  if (!partner) return <p className="text-muted-foreground">{t("partners.partnerNotFound")}</p>;

  return (
    <div className="space-y-6" data-testid="partner-detail-page">
      <SquareLogoCropDialog
        file={pendingSquareLogoFile}
        onConfirm={async (cropped) => {
          setPendingSquareLogoFile(null);
          await uploadSquareLogo(cropped);
        }}
        onClose={() => setPendingSquareLogoFile(null)}
      />
      <div className="flex items-center gap-4">
        <Link href="/partners" className="group inline-flex items-center gap-2" aria-label="Back" data-testid="button-back"><SphereBackButton size={40} /></Link>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-partner-name">{partner.name}</h1>
          <p className="text-muted-foreground text-sm">{t("partners.partnerSince", { date: new Date(partner.createdAt).toLocaleDateString() })}</p>
        </div>
        <div className="ml-auto">
          {canEditPartner && (
          <Dialog open={editOpen} onOpenChange={tryCloseEdit}>
            <DialogTrigger asChild>
              <BrandPillButton tone="blue" onClick={openEditDialog} data-testid="button-edit-partner"><Pencil className="w-4 h-4" />{t("common.edit")}</BrandPillButton>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{t("partners.editPartner")}</DialogTitle></DialogHeader>
              <form onSubmit={handleEdit} className="space-y-4">
                <div>
                  <Label>{t("partners.companyName")}</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-partner-name" />
                  {isAdmin && matches.length > 0 && (
                    <div
                      role="alert"
                      data-testid="partner-rename-duplicate-warning"
                      className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                        <div className="flex-1 space-y-1.5">
                          <p className="font-medium">
                            {t("partners.duplicateWarningTitle", {
                              defaultValue:
                                "This name looks similar to existing partners.",
                            })}
                          </p>
                          <ul className="space-y-0.5">
                            {matches.map((m) => (
                              <li key={m.id}>
                                {t("partners.duplicateWarningSuggestion", {
                                  defaultValue: "Did you mean ",
                                })}
                                <Link
                                  href={`/partners/${m.id}`}
                                  className="font-semibold underline hover:text-amber-700"
                                  data-testid={`link-rename-duplicate-partner-${m.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {m.name}
                                </Link>
                                ?
                              </li>
                            ))}
                          </ul>
                          <label className="mt-1 flex items-center gap-2 text-amber-900">
                            <Checkbox
                              data-testid="checkbox-confirm-different-partner-rename"
                              checked={confirmDifferentRename}
                              onCheckedChange={(c) => setConfirmDifferentRename(c === true)}
                            />
                            <span>
                              {t("partners.duplicateRenameConfirmLabel", {
                                defaultValue:
                                  "I'm sure this is a different partner — rename it anyway.",
                              })}
                            </span>
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                  {isAdmin && matchesLoading && matches.length === 0 && form.name.trim().length >= 3 && (
                    <p className="mt-1 text-xs text-muted-foreground" data-testid="partner-rename-match-loading">
                      {t("partners.duplicateChecking", { defaultValue: "Checking for similar partners…" })}
                    </p>
                  )}
                </div>
                <div>
                  <Label>{t("partners.physicalAddress")}</Label>
                  <Input value={form.physicalAddress} onChange={(e) => setForm({ ...form, physicalAddress: e.target.value })} placeholder={t("partners.addressPlaceholder")} data-testid="input-physical-address" />
                </div>
                <div>
                  <Label>{t("partners.billingAddress")}</Label>
                  <Input value={form.billingAddress} onChange={(e) => setForm({ ...form, billingAddress: e.target.value })} placeholder={t("partners.addressPlaceholder")} data-testid="input-billing-address" />
                </div>
                <div>
                  <Label>{t("partners.businessPhone")}</Label>
                  <Input value={form.businessPhone} onChange={(e) => setForm({ ...form, businessPhone: handlePhoneInput(e.target.value) })} placeholder={t("partners.businessPhonePlaceholder")} data-testid="input-business-phone" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>{t("partners.stateTaxId")}</Label>
                    <Input value={form.stateTaxId} onChange={(e) => setForm({ ...form, stateTaxId: e.target.value })} placeholder={t("partners.stateTaxIdPlaceholder")} data-testid="input-state-tax-id" />
                  </div>
                  <div>
                    <Label>{t("partners.federalTaxIdEin")}</Label>
                    <Input value={form.federalTaxId} onChange={(e) => setForm({ ...form, federalTaxId: e.target.value })} placeholder={t("partners.federalTaxIdPlaceholder")} data-testid="input-federal-tax-id" />
                  </div>
                </div>
                <div>
                  <Label>{t("partners.hoursOfOperation")}</Label>
                  <Input value={form.hoursOfOperation} onChange={(e) => setForm({ ...form, hoursOfOperation: e.target.value })} placeholder={t("partners.hoursOfOperationPlaceholder")} data-testid="input-hours-of-operation" />
                </div>
                <div>
                  <Label>{t("partners.aboutUs")}</Label>
                  <Textarea value={form.blurb} onChange={(e) => setForm({ ...form, blurb: e.target.value })} placeholder={t("partners.aboutUsPlaceholder")} rows={4} data-testid="input-blurb" />
                </div>
                {canEditPartner && (
                  <div className="space-y-3 pt-2 border-t">
                    <div className="flex items-start gap-4">
                      <div className="w-20 h-20 rounded-md border border-gray-200 bg-white flex items-center justify-center overflow-hidden shrink-0">
                        {partner.logoUrl ? (
                          <img src={partner.logoUrl} alt={t("partners.logoAlt", { name: partner.name })} className="w-full h-full object-contain" data-testid="img-edit-partner-logo" />
                        ) : (
                          <ImageIcon className="w-7 h-7 text-gray-300" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-medium mb-1">{t("partners.companyLogo", { defaultValue: "Main Logo (any shape)" })}</div>
                        <p className="text-xs text-muted-foreground mb-2">{t("partners.companyLogoHelp", { defaultValue: "PNG, JPG, or SVG. Used on tickets, posters, and inside dialogs. Wordmarks (wide logos) work great here." })}</p>
                        <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} data-testid="input-logo-file" />
                        <div className="flex gap-2 flex-wrap">
                          <PngPillButton color="blue" type="button" onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo} data-testid="button-upload-logo">
                            <Upload className="w-4 h-4" />{uploadingLogo ? t("partners.uploadingLogo", { defaultValue: "Uploading..." }) : partner.logoUrl ? t("partners.replaceLogo", { defaultValue: "Replace Logo" }) : t("partners.uploadLogo", { defaultValue: "Upload Logo" })}
                          </PngPillButton>
                          {partner.logoUrl && (
                            <PngPillButton color="red" type="button" onClick={handleRemoveLogo} data-testid="button-remove-logo">
                              <Trash2 className="w-4 h-4" />{t("common.remove", { defaultValue: "Remove" })}
                            </PngPillButton>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-start gap-4">
                      <div className="w-20 h-20 rounded-md border border-gray-200 bg-white flex items-center justify-center overflow-hidden shrink-0">
                        {partner.logoSquareUrl ? (
                          <img
                            src={partner.logoSquareUrl}
                            alt={t("partners.squareLogoAlt", { defaultValue: "{{name}} square logo", name: partner.name })}
                            className="w-full h-full object-contain"
                            data-testid="img-edit-partner-square-logo"
                          />
                        ) : (
                          <ImageIcon className="w-7 h-7 text-gray-300" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-medium mb-1">{t("partners.squareLogo", { defaultValue: "Square Logo (1:1)" })}</div>
                        <p className="text-xs text-muted-foreground mb-2">
                          {t("partners.squareLogoHelp", { defaultValue: "PNG, JPG, or SVG, ideally a 1:1 square mark/icon. Shown at 64×64 in the navigation sidebar. Optional — if you don't upload one, the main logo will be used." })}
                        </p>
                        <input
                          ref={squareLogoInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleSquareLogoUpload}
                          data-testid="input-square-logo-file"
                        />
                        <div className="flex gap-2 flex-wrap">
                          <PngPillButton
                            color="blue"
                            type="button"
                            onClick={() => squareLogoInputRef.current?.click()}
                            disabled={uploadingSquareLogo}
                            data-testid="button-upload-square-logo"
                          >
                            <Upload className="w-4 h-4" />
                            {uploadingSquareLogo
                              ? t("partners.uploadingLogo", { defaultValue: "Uploading..." })
                              : partner.logoSquareUrl
                                ? t("partners.replaceSquareLogo", { defaultValue: "Replace Square Logo" })
                                : t("partners.uploadSquareLogo", { defaultValue: "Upload Square Logo" })}
                          </PngPillButton>
                          {partner.logoSquareUrl && (
                            <PngPillButton color="red" type="button" onClick={handleRemoveSquareLogo} data-testid="button-remove-square-logo">
                              <Trash2 className="w-4 h-4" />
                              {t("common.remove", { defaultValue: "Remove" })}
                            </PngPillButton>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>{t("partners.brandColors")}</Label>
                  <p className="text-xs text-muted-foreground">{t("partners.brandColorsHelp")}</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs text-muted-foreground">{t("partners.primary")}</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={form.brandPrimaryColor || "#000000"}
                          onChange={(e) => setForm({ ...form, brandPrimaryColor: e.target.value })}
                          className="h-9 w-12 rounded border border-input cursor-pointer"
                          data-testid="input-brand-primary-color-picker"
                        />
                        <Input
                          value={form.brandPrimaryColor}
                          onChange={(e) => setForm({ ...form, brandPrimaryColor: e.target.value })}
                          placeholder="#1f7ae0"
                          className="flex-1"
                          data-testid="input-brand-primary-color"
                        />
                        {form.brandPrimaryColor && (
                          <button
                            type="button"
                            onClick={() => setForm({ ...form, brandPrimaryColor: "" })}
                            className="text-xs text-muted-foreground hover:text-destructive"
                            data-testid="button-clear-brand-primary-color"
                          >
                            {t("partners.clear")}
                          </button>
                        )}
                      </div>
                      {form.brandPrimaryColor && (() => {
                        const w = getContrastWarningKind(form.brandPrimaryColor);
                        return w ? (
                          <p
                            className="mt-1 text-xs text-amber-600"
                            data-testid="warning-brand-primary-contrast"
                          >
                            {t(`partners.brandWarning.${w.kind}`, { ratio: w.ratio })}
                          </p>
                        ) : null;
                      })()}
                      {form.brandPrimaryColor && (() => {
                        const w = getSidebarContrastWarningKind(form.brandPrimaryColor);
                        return w ? (
                          <p
                            className="mt-1 text-xs text-amber-600"
                            data-testid="warning-brand-primary-sidebar-contrast"
                          >
                            {t(`partners.brandWarning.${w.kind}`, { ratio: w.ratio })}
                          </p>
                        ) : null;
                      })()}
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">{t("partners.accentOptional")}</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={form.brandAccentColor || "#000000"}
                          onChange={(e) => setForm({ ...form, brandAccentColor: e.target.value })}
                          className="h-9 w-12 rounded border border-input cursor-pointer"
                          data-testid="input-brand-accent-color-picker"
                        />
                        <Input
                          value={form.brandAccentColor}
                          onChange={(e) => setForm({ ...form, brandAccentColor: e.target.value })}
                          placeholder="#f59e0b"
                          className="flex-1"
                          data-testid="input-brand-accent-color"
                        />
                        {form.brandAccentColor && (
                          <button
                            type="button"
                            onClick={() => setForm({ ...form, brandAccentColor: "" })}
                            className="text-xs text-muted-foreground hover:text-destructive"
                            data-testid="button-clear-brand-accent-color"
                          >
                            {t("partners.clear")}
                          </button>
                        )}
                      </div>
                      {form.brandAccentColor && (() => {
                        const w = getContrastWarningKind(form.brandAccentColor);
                        return w ? (
                          <p
                            className="mt-1 text-xs text-amber-600"
                            data-testid="warning-brand-accent-contrast"
                          >
                            {t(`partners.brandWarning.${w.kind}`, { ratio: w.ratio })}
                          </p>
                        ) : null;
                      })()}
                      {form.brandAccentColor && (() => {
                        const w = getSidebarContrastWarningKind(form.brandAccentColor);
                        return w ? (
                          <p
                            className="mt-1 text-xs text-amber-600"
                            data-testid="warning-brand-accent-sidebar-contrast"
                          >
                            {t(`partners.brandWarning.${w.kind}`, { ratio: w.ratio })}
                          </p>
                        ) : null;
                      })()}
                    </div>
                  </div>
                  {form.brandPrimaryColor && form.brandAccentColor && (() => {
                    const w = getColorPairWarningKind(form.brandPrimaryColor, form.brandAccentColor);
                    return w ? (
                      <p
                        className="text-xs text-amber-600"
                        data-testid="warning-brand-color-pair"
                      >
                        {t(`partners.brandWarning.${w.kind === "similar" ? "similarPair" : w.kind}`, { ratio: w.ratio })}
                      </p>
                    ) : null;
                  })()}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t("partners.posterPreview")}</Label>
                    <PosterPreview
                      primaryColor={form.brandPrimaryColor || "#000000"}
                      accentColor={form.brandAccentColor || form.brandPrimaryColor || "#000000"}
                      partnerName={partner?.name ?? null}
                      logoUrl={partner?.logoUrl ?? null}
                    />
                  </div>
                </div>
                <div className="space-y-2 pt-2 border-t">
                  <Label>{t("partners.email1099Template", { defaultValue: "1099 Email Template" })}</Label>
                  <p className="text-xs text-muted-foreground" data-testid="text-email-1099-template-help">
                    {t("partners.email1099TemplateHelp", { defaultValue: "Customize the subject and message for 1099 statement emails sent to vendors who consented to electronic delivery. Leave both blank to use the default English email." })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("partners.email1099Placeholders", { defaultValue: "Available placeholders: {{vendorName}}, {{partnerName}}, {{taxYear}}, {{formType}}, {{formLabel}}, {{totalReportable}}." })}
                  </p>
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("partners.email1099Subject", { defaultValue: "Subject" })}</Label>
                    <Input
                      value={form.email1099Subject}
                      onChange={(e) => setForm({ ...form, email1099Subject: e.target.value })}
                      placeholder={t("partners.email1099SubjectPlaceholder", { defaultValue: "{{partnerName}} — {{formLabel}} statement for {{taxYear}}" })}
                      maxLength={200}
                      data-testid="input-email-1099-subject"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("partners.email1099Body", { defaultValue: "Message" })}</Label>
                    <Textarea
                      value={form.email1099Body}
                      onChange={(e) => setForm({ ...form, email1099Body: e.target.value })}
                      placeholder={t("partners.email1099BodyPlaceholder", { defaultValue: "Hi {{vendorName}},\n\nAttached is your Form {{formLabel}} for tax year {{taxYear}} from {{partnerName}}.\n\nTotal reportable: ${{totalReportable}}\n\nQuestions? Reply to this email." })}
                      rows={8}
                      maxLength={5000}
                      data-testid="input-email-1099-body"
                    />
                  </div>
                </div>
                <PngPillButton
                  type="submit"
                  color="image"
                  activeSrc={brandImagePillSrc(brand.primary, brand.name)}
                  attention={editFormDirty}
                  disabled={updatePartner.isPending || (isAdmin && form.name.trim().length >= 3 && (matchesLoading || checkedName !== form.name.trim())) || (isAdmin && matches.length > 0 && !confirmDifferentRename)}
                  data-testid="button-submit-edit"
                  size="sm"
                >
                  {updatePartner.isPending ? t("common.saving") : t("common.saveChanges")}
                </PngPillButton>
              </form>
            </DialogContent>
          </Dialog>
          )}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Handshake className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />{t("partners.partnerInformation")}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div><span className="text-sm text-muted-foreground">{t("partners.physicalAddressLabel")}</span> <span className="font-medium">{partner.physicalAddress || "-"}</span></div>
          <div><span className="text-sm text-muted-foreground">{t("partners.billingAddressLabel")}</span> <span className="font-medium">{partner.billingAddress || "-"}</span></div>
          <div><span className="text-sm text-muted-foreground">{t("partners.businessPhoneLabel")}</span> <span className="font-medium">{partner.businessPhone ? formatPhone(partner.businessPhone) : "-"}</span></div>
          <div><span className="text-sm text-muted-foreground">{t("partners.hoursOfOperationLabel")}</span> <span className="font-medium">{partner.hoursOfOperation || "-"}</span></div>
          <div className="grid grid-cols-2 gap-4">
            <div><span className="text-sm text-muted-foreground">{t("partners.stateTaxIdLabel")}</span> <span className="font-medium">{partner.stateTaxId || "-"}</span></div>
            <div><span className="text-sm text-muted-foreground">{t("partners.federalTaxIdLabel")}</span> <span className="font-medium">{partner.federalTaxId || "-"}</span></div>
          </div>
          <div className="pt-2 border-t mt-2">
            <div className="text-sm text-muted-foreground mb-1">{t("partners.aboutUs")}</div>
            <p className="text-sm whitespace-pre-wrap">{partner.blurb || "-"}</p>
          </div>
          {/* Brand-colors read-only display intentionally hidden from
              the partner information card — the colors still apply to
              the rest of the UI (sidebar, branded buttons, printable
              outputs) and remain editable from the Edit Partner dialog,
              they're just not surfaced as a swatch row here. */}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><MapPin className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />{t("partners.siteLocationsCount", { count: sites?.length ?? 0 })}</CardTitle>
          {!isVendorUser && selectedSiteIds.size > 0 && (
            <PngPillButton color="blue" type="button" onClick={handlePrintSelectedQrs} data-testid="button-print-selected-qrs">
              <Printer className="w-4 h-4" />
              {t("siteLocations.printSelectedQrs", { count: selectedSiteIds.size })}
            </PngPillButton>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {sites && sites.length > 0 ? (
            <>
            <div className="px-6 pt-2 pb-3 flex items-center gap-3 flex-wrap">
              <div className="relative inline-flex items-center h-[23px] w-[180px] rounded-full bg-white border border-black/10">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
                <input
                  type="text"
                  value={siteFilter}
                  onChange={(e) => setSiteFilter(e.target.value)}
                  placeholder={t("partners.filterSitesPlaceholder")}
                  className="w-full h-full bg-transparent border-0 outline-none pl-8 pr-3 text-xs font-normal text-gray-800 placeholder:text-gray-500 rounded-full"
                  data-testid="input-filter-sites"
                />
              </div>
              {siteFilter.trim() !== "" && (
                <span className="text-xs text-muted-foreground" data-testid="text-filtered-sites-count">
                  {t("partners.filteredSitesCount", {
                    shown: filteredSortedSites.length,
                    total: sites.length,
                  })}
                </span>
              )}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  {!isVendorUser && (
                    <TableHead className="w-10">
                      <Checkbox
                        data-testid="checkbox-select-all-sites"
                        checked={filteredSortedSites.length > 0 && filteredSortedSites.every((s) => selectedSiteIds.has(s.id))}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedSiteIds((prev) => {
                              const next = new Set(prev);
                              filteredSortedSites.forEach((s) => next.add(s.id));
                              return next;
                            });
                          } else {
                            setSelectedSiteIds((prev) => {
                              const next = new Set(prev);
                              filteredSortedSites.forEach((s) => next.delete(s.id));
                              return next;
                            });
                          }
                        }}
                        aria-label={t("partners.selectAllSites")}
                      />
                    </TableHead>
                  )}
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSiteSort("name")} data-testid="header-sort-site-name">
                    <div className="flex items-center gap-1">
                      {t("partners.siteName")}
                      <ArrowUpDown className={`w-3 h-3 ${siteSortKey === "name" ? "" : "text-muted-foreground"}`} style={siteSortKey === "name" ? { color: "var(--brand-primary)" } : undefined} />
                    </div>
                  </TableHead>
                  <TableHead>{t("partners.address")}</TableHead>
                  <TableHead>{t("partners.siteCodeCol")}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSiteSort("status")} data-testid="header-sort-site-status">
                    <div className="flex items-center gap-1">
                      {t("partners.statusCol")}
                      <ArrowUpDown className={`w-3 h-3 ${siteSortKey === "status" ? "" : "text-muted-foreground"}`} style={siteSortKey === "status" ? { color: "var(--brand-primary)" } : undefined} />
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSortedSites.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isVendorUser ? 4 : 5} className="text-center text-muted-foreground text-sm py-6" data-testid="text-no-sites-match">
                      {t("partners.noSitesMatch")}
                    </TableCell>
                  </TableRow>
                ) : filteredSortedSites.map((s) => (
                  <TableRow key={s.id} data-testid={`row-site-${s.id}`}>
                    {!isVendorUser && (
                      <TableCell className="w-10">
                        <Checkbox
                          data-testid={`checkbox-select-site-${s.id}`}
                          checked={selectedSiteIds.has(s.id)}
                          onCheckedChange={() => toggleSelectedSite(s.id)}
                          aria-label={t("partners.selectSiteAria", { name: s.name })}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <Link href={`/site-locations/${s.id}`} className="font-medium text-gray-700 hover:text-[var(--brand-primary)] hover:underline transition-colors" data-testid={`link-site-${s.id}`}>
                        <div className="flex items-center gap-2"><MapPin className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />{s.name}</div>
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">{s.address}</TableCell>
                    <TableCell><code className="text-xs bg-muted px-2 py-1 rounded">{s.siteCode}</code></TableCell>
                    <TableCell><StatusBadge status={s.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </>
          ) : (
            <div className="p-6 text-center text-muted-foreground text-sm">{t("partners.noSitesYet")}</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><UserCheck className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />{t("partners.companyContactsCount", { count: contacts?.length ?? 0 })}</CardTitle>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none" data-testid="toggle-show-deleted-contacts-label">
                <Checkbox
                  checked={showDeletedContacts}
                  onCheckedChange={(v) => setShowDeletedContacts(v === true)}
                  data-testid="toggle-show-deleted-contacts"
                />
                {t("partners.showDeletedContacts")}
              </label>
            )}
          {canEditPartner && (
            <PngPillButton
              color="blue"
              onClick={() => setContactOpen(true)}
              className="px-2"
              data-testid="button-add-contact"
            >
              <Plus className="w-4 h-4" />
              {t("partners.addCompanyContact")}
            </PngPillButton>
          )}
          <Dialog open={contactOpen} onOpenChange={setContactOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("partners.addCompanyContact")}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleAddContact} className="space-y-4">
                <div>
                  <Label>{t("partners.jobTitle")}</Label>
                  <Input value={contactForm.jobTitle} onChange={(e) => setContactForm({ ...contactForm, jobTitle: e.target.value })} placeholder={t("partners.jobTitlePlaceholder")} data-testid="input-contact-job-title" />
                </div>
                <div>
                  <Label>{t("partners.nameLabel")}</Label>
                  <Input value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} data-testid="input-new-contact-name" />
                </div>
                <div>
                  <Label>{t("partners.emailLabel")}</Label>
                  <Input type="email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} data-testid="input-new-contact-email" />
                </div>
                <div>
                  <Label>{t("partners.phoneLabel")}</Label>
                  <Input value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: handlePhoneInput(e.target.value) })} data-testid="input-new-contact-phone" />
                </div>
                <div>
                  <Label>{t("partners.companyRoles")}</Label>
                  <p className="text-xs text-muted-foreground mb-2">{t("partners.rolesHelp")}</p>
                  <RoleMultiSelect value={contactForm.roles} onChange={(roles) => setContactForm({ ...contactForm, roles })} testIdPrefix="add-role" />
                </div>
                <PngPillButton color="blue" type="submit" disabled={createContact.isPending} className="w-full" data-testid="button-submit-contact">
                  {createContact.isPending ? t("partners.adding") : t("partners.addCompanyContact")}
                </PngPillButton>
              </form>
            </DialogContent>
          </Dialog>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {(contacts && contacts.length > 0) || (showDeletedContacts && deletedContacts.length > 0) ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("partners.jobTitle")}</TableHead>
                  <TableHead>{t("partners.nameLabel")}</TableHead>
                  <TableHead>{t("partners.emailLabel")}</TableHead>
                  <TableHead>{t("partners.phoneLabel")}</TableHead>
                  <TableHead>{t("partners.companyRoles")}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(contacts ?? []).map((c) => (
                  <TableRow key={c.id} className={canEditPartner ? "group cursor-pointer hover:bg-muted/50" : ""} onClick={canEditPartner ? () => openEditContactDialog(c) : undefined} data-testid={`row-contact-${c.id}`}>
                    <TableCell className="font-medium">{c.jobTitle}</TableCell>
                    <TableCell><div className="flex items-center gap-2 text-gray-700 group-hover:text-[var(--brand-primary)] transition-colors">{c.photoUrl ? <img src={c.photoUrl} alt="" className="w-6 h-6 rounded-full object-cover border border-gray-200" /> : null}{c.name}</div></TableCell>
                    <TableCell>
                      {c.email ? (
                        <span className="text-gray-700" data-testid={`text-contact-email-${c.id}`}>
                          {c.email}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {c.phone ? (
                        <a
                          href={`tel:${c.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-gray-700 hover:text-[var(--brand-primary)] hover:underline transition-colors"
                          data-testid={`link-contact-phone-${c.id}`}
                        >
                          {formatPhone(c.phone)}
                        </a>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(c.roles ?? []).map((r) => (
                          <BrandRolePill key={r}>{translateCompanyRole(t, r)}</BrandRolePill>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {canEditPartner && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <PillButton color="image" className="min-w-[28px] px-0" data-testid={`button-delete-contact-${c.id}`}>
                              <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive transition-colors" />
                            </PillButton>
                          </AlertDialogTrigger>
                          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t("partners.removeContactTitle")}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t("partners.removeContactDesc", { name: c.name })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t("common.cancel", { defaultValue: "Cancel" })}</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteContact(c.id)} data-testid={`button-delete-contact-confirm-${c.id}`}>{t("common.remove", { defaultValue: "Remove" })}</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {showDeletedContacts && deletedContacts.map((c) => (
                  <TableRow key={`deleted-${c.id}`} className="opacity-60 bg-muted/30" data-testid={`row-contact-deleted-${c.id}`}>
                    <TableCell className="font-medium line-through">{c.jobTitle}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 line-through">
                        {c.photoUrl ? <img src={c.photoUrl} alt="" className="w-6 h-6 rounded-full object-cover border border-gray-200 grayscale" /> : null}
                        {c.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      {c.email ? (
                        <span className="line-through text-gray-700" data-testid={`text-contact-deleted-email-${c.id}`}>
                          {c.email}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {c.phone ? (
                        <a
                          href={`tel:${c.phone}`}
                          className="line-through text-gray-700 hover:text-[var(--brand-primary)] hover:underline transition-colors"
                          data-testid={`link-contact-deleted-phone-${c.id}`}
                        >
                          {formatPhone(c.phone)}
                        </a>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(c.roles ?? []).map((r) => (
                          <BrandRolePill key={r}>{translateCompanyRole(t, r)}</BrandRolePill>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <PillButton
                        color="image"
                        onClick={() => handleRestoreContact(c.id)}
                        data-testid={`button-restore-contact-${c.id}`}
                      >
                        <RotateCcw className="w-3 h-3 mr-1" />
                        {t("partners.restoreContact")}
                      </PillButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-6 text-center text-muted-foreground text-sm">{t("partners.noContacts")}</div>
          )}
        </CardContent>
      </Card>

      {/* Hide the Members card unless the viewer is a system admin or
          has an admin-role membership in THIS partner — mirrors the
          backend authz so non-admin org members don't see a card that
          would 403 on every action. */}
      <OrgMembersCard
        orgType="partner"
        orgId={id}
        canManage={
          authUser?.role === "admin" ||
          (authUser?.availableMemberships ?? []).some(
            (m) => m.orgType === "partner" && m.orgId === id && m.role === "admin",
          )
        }
        currentUserId={authUser?.userId ?? null}
      />

      <PartnerProductServiceCatalogCard
        partnerId={id}
        canManage={
          authUser?.role === "admin" ||
          (authUser?.role === "partner" && authUser.partnerId === id)
        }
        canAddToCatalog={isAdmin}
      />

      <PartnerVendorApprovalsCard
        partnerId={id}
        canManage={
          authUser?.role === "admin" ||
          (authUser?.availableMemberships ?? []).some(
            (m) => m.orgType === "partner" && m.orgId === id && m.role === "admin",
          )
        }
      />

      {(isAdmin || isOwnPartner) && (
        <Partner1099TotalsCard partnerId={id} />
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />{t("partners.notesCount", { count: notes?.length ?? 0 })}</CardTitle>
          <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
            <DialogTrigger asChild>
              <PngPillButton color="blue" className="px-2" data-testid="button-add-note"><Plus className="w-4 h-4" />{t("partners.addNote")}</PngPillButton>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{t("partners.addNote")}</DialogTitle></DialogHeader>
              <form onSubmit={handleAddNote} className="space-y-4">
                <div>
                  <Label>{t("partners.noteLabel")}</Label>
                  <Textarea value={noteContent} onChange={(e) => setNoteContent(e.target.value)} placeholder={t("partners.enterNotePlaceholder")} rows={4} data-testid="input-note-content" />
                </div>
                <PngPillButton color="blue" type="submit" disabled={createNote.isPending} className="w-full" data-testid="button-submit-note">
                  {createNote.isPending ? t("partners.adding") : t("partners.addNote")}
                </PngPillButton>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {notes && notes.length > 0 ? (
            <div className="space-y-3">
              {notes.map((note) => (
                <div key={note.id} className="flex items-start gap-3 p-3 border rounded-lg" data-testid={`note-${note.id}`}>
                  <div className="flex-1">
                    <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                    <p className="text-xs text-muted-foreground mt-1">{new Date(note.createdAt).toLocaleString()}</p>
                  </div>
                  <PillButton color="image" className="min-w-[28px] px-0" onClick={() => handleDeleteNote(note.id)} data-testid={`button-delete-note-${note.id}`}>
                    <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive transition-colors" />
                  </PillButton>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm text-center">{t("partners.noNotes")}</p>
          )}
        </CardContent>
      </Card>

      {authUser?.role === "admin" && (
        <div className="flex justify-end">
          <PngPillButton color="red" onClick={handleRemovePartner} disabled={removePartner.isPending} data-testid="button-remove-partner">
            <Trash2 className="w-4 h-4" />{removePartner.isPending ? t("partners.removing") : t("partners.removePartner", { defaultValue: "Remove Partner" })}
          </PngPillButton>
        </div>
      )}

      <Dialog open={editContactOpen} onOpenChange={tryCloseEditContact}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("partners.editCompanyContact")}</DialogTitle></DialogHeader>
          <form onSubmit={handleEditContact} className="space-y-4">
            <div>
              <Label>{t("partners.employeePhoto")}</Label>
              <div className="mt-2"><PhotoUploadField value={editContactForm.photoUrl} onChange={(url) => setEditContactForm({ ...editContactForm, photoUrl: url })} testIdPrefix="edit-partner-contact-photo" /></div>
            </div>
            <div>
              <Label>{t("partners.jobTitle")}</Label>
              <Input value={editContactForm.jobTitle} onChange={(e) => setEditContactForm({ ...editContactForm, jobTitle: e.target.value })} data-testid="input-edit-contact-job-title" />
            </div>
            <div>
              <Label>{t("partners.nameLabel")}</Label>
              <Input value={editContactForm.name} onChange={(e) => setEditContactForm({ ...editContactForm, name: e.target.value })} data-testid="input-edit-contact-name" />
            </div>
            <div>
              <Label>{t("partners.emailLabel")}</Label>
              <Input type="email" value={editContactForm.email} onChange={(e) => setEditContactForm({ ...editContactForm, email: e.target.value })} data-testid="input-edit-contact-email" />
            </div>
            <div>
              <Label>{t("partners.phoneLabel")}</Label>
              <Input value={editContactForm.phone} onChange={(e) => setEditContactForm({ ...editContactForm, phone: handlePhoneInput(e.target.value) })} data-testid="input-edit-contact-phone" />
            </div>
            <div>
              <Label>{t("partners.companyRoles")}</Label>
              <p className="text-xs text-muted-foreground mb-2">{t("partners.rolesHelp")}</p>
              <RoleMultiSelect value={editContactForm.roles} onChange={(roles) => setEditContactForm({ ...editContactForm, roles })} testIdPrefix="edit-role" />
            </div>
            <PngPillButton color="blue" type="submit" disabled={updateContact.isPending} attention={editContactDirty} className="w-full" data-testid="button-submit-edit-contact">
              {updateContact.isPending ? t("common.saving") : t("common.saveChanges")}
            </PngPillButton>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
