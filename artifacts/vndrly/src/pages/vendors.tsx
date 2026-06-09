import { useEffect, useState } from "react";
import {
  useListVendors,
  useCreateVendor,
  useUpdateVendor,
  getListVendorsQueryKey,
  matchVendor,
} from "@workspace/api-client-react";
import type { MatchVendorResponseItem } from "@workspace/api-client-react";
import { formatPhone, handlePhoneInput, stripPhone } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import SphereBackButton from "@/components/sphere-back-button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Users, ArrowUp, ArrowDown, AlertTriangle, BellRing, BellOff } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import BlueButton from "@/components/blue-button";
import BrandPillButton from "@/components/brand-pill-button";
import { PngPillButton } from "@/components/png-pill-rollover";
import { useBrand } from "@/hooks/use-brand";
import { useTranslation } from "react-i18next";

// Mirrors PartnerRowLogo: prefer the uploaded logo, fall back to the
// historical Users icon. The fallback is tinted with the vendor's brand
// primary color when one is set so an unbranded vendor still looks neutral
// while branded-but-logoless vendors show their identity.
function VendorRowLogo({
  logoUrl,
  logoSquareUrl,
  name,
  vendorId,
  altText,
  primaryColor,
  fallbackColor,
}: {
  logoUrl: string | null | undefined;
  /**
   * Preferred over `logoUrl` when present. Square (1:1) crops render
   * crisply in the small 24x24 row chip without the irregular
   * letterboxing that wide partner logos get when squeezed into a
   * square footprint. Mirrors the sidebar's same fallback chain.
   */
  logoSquareUrl?: string | null | undefined;
  name: string;
  vendorId: number;
  altText: string;
  primaryColor: string | null;
  fallbackColor: string;
}) {
  const [errored, setErrored] = useState(false);
  const preferred =
    typeof logoSquareUrl === "string" && logoSquareUrl.trim()
      ? logoSquareUrl.trim()
      : typeof logoUrl === "string"
        ? logoUrl.trim()
        : "";
  const trimmed = preferred;
  if (!trimmed || errored) {
    return (
      <Users
        className="w-4 h-4 shrink-0"
        style={{ color: primaryColor ?? fallbackColor }}
        data-testid={`icon-vendor-${vendorId}`}
      />
    );
  }
  return (
    <img
      src={trimmed}
      alt={altText || `${name} logo`}
      className="w-6 h-6 rounded-sm object-contain bg-white border border-gray-200 shrink-0"
      data-testid={`img-vendor-row-logo-${vendorId}`}
      onError={() => setErrored(true)}
    />
  );
}

export default function Vendors() {
  const { t } = useTranslation();
  const brand = useBrand();
  const accentColor = brand.isOrgBranded ? brand.primary : "#f59e0b";
  const iconStyle = { color: accentColor };
  const { data: vendors, isLoading } = useListVendors();
  const createVendor = useCreateVendor();
  const updateVendor = useUpdateVendor();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", contactName: "", contactEmail: "", contactPhone: "", physicalAddress: "", billingAddress: "" });
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  // Reconciliation-drift alert filter & bulk-enable selection. Defaults
  // to "all" so existing admins see every vendor; switching to "off"
  // makes it trivial to find candidates for the bulk-enable action.
  const [reconAlertFilter, setReconAlertFilter] = useState<"all" | "on" | "off">("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkEnabling, setBulkEnabling] = useState(false);
  const [matches, setMatches] = useState<MatchVendorResponseItem[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  // The name the most recent match call resolved for; gates submit so
  // a fast Enter can't slip through before the debounced check fires.
  const [checkedName, setCheckedName] = useState<string | null>(null);
  const [confirmDifferent, setConfirmDifferent] = useState(false);

  const handleSort = (col: string) => {
    if (sortCol === col) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortCol(null); setSortDir("asc"); }
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const sortIcon = (col: string) => {
    if (sortCol !== col) return null;
    return sortDir === "asc" ? <ArrowUp className="w-3.5 h-3.5" style={iconStyle} /> : <ArrowDown className="w-3.5 h-3.5" style={iconStyle} />;
  };

  // Apply the recon-alert status filter before sorting so the sort
  // operates on the visible subset (otherwise rendering the filtered
  // rows would skip the chosen sort order on the hidden rows).
  const filteredVendors = (() => {
    if (!vendors) return vendors;
    if (reconAlertFilter === "all") return vendors;
    return vendors.filter((v) =>
      reconAlertFilter === "on"
        ? v.accountingReconciliationNotificationsEnabled
        : !v.accountingReconciliationNotificationsEnabled,
    );
  })();

  const sortedVendors = (() => {
    if (!filteredVendors || !sortCol) return filteredVendors;
    return [...filteredVendors].sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortCol) {
        case "name": aVal = a.name.toLowerCase(); bVal = b.name.toLowerCase(); break;
        case "contact": aVal = (a.contactName || "").toLowerCase(); bVal = (b.contactName || "").toLowerCase(); break;
        case "email": aVal = (a.contactEmail || "").toLowerCase(); bVal = (b.contactEmail || "").toLowerCase(); break;
        case "phone": aVal = a.contactPhone || ""; bVal = b.contactPhone || ""; break;
        case "created": aVal = a.createdAt; bVal = b.createdAt; break;
        // Sort booleans so "On" groups together regardless of direction
        // (true=1, false=0). Useful when admins want to scan who's
        // already opted in vs. still off without flipping the filter.
        case "reconAlerts":
          aVal = a.accountingReconciliationNotificationsEnabled ? 1 : 0;
          bVal = b.accountingReconciliationNotificationsEnabled ? 1 : 0;
          break;
        default: return 0;
      }
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  })();

  // Bulk-enable helpers. We only let admins select rows whose alert is
  // currently OFF — selecting a vendor that's already opted in would
  // be a no-op PATCH and could confuse the toast count, so we hide the
  // checkbox entirely for those rows.
  const eligibleForBulkEnable = (sortedVendors ?? []).filter(
    (v) => !v.accountingReconciliationNotificationsEnabled,
  );
  const visibleSelectedIds = (sortedVendors ?? [])
    .filter((v) => selectedIds.has(v.id) && !v.accountingReconciliationNotificationsEnabled)
    .map((v) => v.id);
  const allEligibleSelected =
    eligibleForBulkEnable.length > 0 &&
    eligibleForBulkEnable.every((v) => selectedIds.has(v.id));

  const toggleSelectVendor = (id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleSelectAllEligible = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const v of eligibleForBulkEnable) {
        if (checked) next.add(v.id);
        else next.delete(v.id);
      }
      return next;
    });
  };

  const handleBulkEnable = async () => {
    if (visibleSelectedIds.length === 0 || bulkEnabling) return;
    setBulkEnabling(true);
    let succeeded = 0;
    let failed = 0;
    // Sequential PATCHes keep the server load predictable and let any
    // 4xx (e.g. recon-derive engine bouncing back) fail loudly per row
    // rather than swallowing errors in a Promise.all.
    for (const id of visibleSelectedIds) {
      try {
        await updateVendor.mutateAsync({
          id,
          data: { accountingReconciliationNotificationsEnabled: true },
        });
        succeeded += 1;
      } catch {
        failed += 1;
      }
    }
    await queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey() });
    setSelectedIds(new Set());
    setBulkEnabling(false);
    if (failed === 0) {
      toast({
        title: t("vendors.bulkEnableReconSuccess", {
          count: succeeded,
          defaultValue: `Enabled drift alerts on ${succeeded} vendor${succeeded === 1 ? "" : "s"}.`,
        }),
      });
    } else {
      toast({
        title: t("vendors.bulkEnableReconPartial", {
          succeeded,
          failed,
          defaultValue: `Enabled drift alerts on ${succeeded} vendor${succeeded === 1 ? "" : "s"}; ${failed} failed.`,
        }),
        variant: "destructive",
      });
    }
  };

  // Debounced fuzzy lookup; AbortController prevents stale responses
  // from overwriting state for a newer name.
  useEffect(() => {
    if (!open) return;
    const trimmed = form.name.trim();
    setConfirmDifferent(false);
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
        const res = await matchVendor(
          { name: trimmed },
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setMatches(res.matches);
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
  }, [form.name, open]);

  useEffect(() => {
    if (open) {
      setMatches([]);
      setConfirmDifferent(false);
      setCheckedName(null);
    }
  }, [open]);

  // Split matches into "hard" (canonical-name collision — server will
  // 409 on POST) vs "near" (fuzzy lookalikes the admin can override
  // with the confirm checkbox). The match endpoint scores an exact
  // canonical match as 1.0 (see name-match.ts:similarity), which is
  // the same rule POST /vendors uses to reject duplicates, so we use
  // >= 0.999 as the hard-duplicate cutoff. Hard duplicates show an
  // inline blocker with the conflicting name *before* submit instead
  // of only after the 409 toast fires.
  const hardMatches = matches.filter((m) => m.score >= 0.999);
  const nearMatches = matches.filter((m) => m.score < 0.999);
  const hasHardDuplicate = hardMatches.length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = form.name.trim();
    if (trimmed.length >= 3 && (matchesLoading || checkedName !== trimmed)) {
      toast({
        title: t("vendors.duplicateChecking", {
          defaultValue: "Checking for similar vendors…",
        }),
      });
      return;
    }
    if (hasHardDuplicate) {
      // Should not be reachable because the submit button is disabled
      // when hasHardDuplicate is true, but guard against fast Enter
      // presses / programmatic submits.
      toast({
        title: t("vendors.duplicateExactExists", {
          name: hardMatches[0].name,
          defaultValue: `A vendor named "${hardMatches[0].name}" already exists.`,
        }),
        variant: "destructive",
      });
      return;
    }
    if (nearMatches.length > 0 && !confirmDifferent) {
      toast({
        title: t("vendors.duplicateConfirmRequired", {
          defaultValue:
            "Please confirm this is a different vendor before continuing.",
        }),
        variant: "destructive",
      });
      return;
    }
    createVendor.mutate(
      { data: { ...form, contactPhone: stripPhone(form.contactPhone) || null, physicalAddress: form.physicalAddress || null, billingAddress: form.billingAddress || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey() });
          setOpen(false);
          setForm({ name: "", contactName: "", contactEmail: "", contactPhone: "", physicalAddress: "", billingAddress: "" });
          setMatches([]);
          setConfirmDifferent(false);
          toast({ title: t("vendors.createSuccess") });
        },
        onError: (err) => {
          // The server blocks exact-name duplicates with a 409. The
          // in-form fuzzy check normally catches this first, but a fast
          // submit, a stale tab, or a direct API caller can still hit
          // it — show a specific message so the user understands why.
          const status = (err as { status?: number } | null)?.status;
          if (status === 409) {
            const data = (err as { data?: { existingVendor?: { name?: string } } } | null)?.data;
            const existingName = data?.existingVendor?.name;
            toast({
              title: existingName
                ? t("vendors.duplicateExactExists", {
                    name: existingName,
                    defaultValue: `A vendor named "${existingName}" already exists.`,
                  })
                : t("vendors.duplicateExactExistsGeneric", {
                    defaultValue: "A vendor with this name already exists.",
                  }),
              variant: "destructive",
            });
            return;
          }
          toast({ title: t("vendors.createFailed"), variant: "destructive" });
        },
      },
    );
  };

  const trimmedName = form.name.trim();
  const checkPending =
    trimmedName.length >= 3 && (matchesLoading || checkedName !== trimmedName);
  const submitDisabled =
    createVendor.isPending ||
    checkPending ||
    hasHardDuplicate ||
    (nearMatches.length > 0 && !confirmDifferent);

  return (
    <div className="space-y-6" data-testid="vendors-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="group inline-flex items-center" aria-label="Back" data-testid="button-back"><SphereBackButton size={40} /></Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">{t("vendors.title")}</h1>
            <p className="text-muted-foreground text-sm mt-1">{t("vendors.subtitle", { defaultValue: "Manage vendor companies" })}</p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <PngPillButton color="blue" className="px-2" data-testid="button-add-vendor"><Plus className="w-4 h-4" />{t("vendors.addVendor")}</PngPillButton>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{t("vendors.addVendor")}</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>{t("vendors.companyName")}</Label>
                <Input data-testid="input-vendor-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                {hasHardDuplicate ? (
                  // Hard (canonical-name) duplicate: server will 409 on
                  // submit no matter what, so render a red blocker
                  // without the "I confirm" override and without the
                  // amber soft-warning styling.
                  <div
                    role="alert"
                    data-testid="vendor-duplicate-hard"
                    className="mt-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
                      <div className="flex-1 space-y-1.5">
                        <p className="font-medium">
                          {t("vendors.duplicateExactExists", {
                            name: hardMatches[0].name,
                            defaultValue: `A vendor named "${hardMatches[0].name}" already exists.`,
                          })}
                        </p>
                        <p>
                          <Link
                            href={`/vendors/${hardMatches[0].id}`}
                            className="font-semibold underline hover:text-red-700"
                            data-testid={`link-existing-vendor-${hardMatches[0].id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t("vendors.duplicateExactOpen", {
                              defaultValue: "Open existing vendor",
                            })}
                          </Link>
                        </p>
                      </div>
                    </div>
                  </div>
                ) : nearMatches.length > 0 ? (
                  <div
                    role="alert"
                    data-testid="vendor-duplicate-warning"
                    className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                      <div className="flex-1 space-y-1.5">
                        <p className="font-medium">
                          {t("vendors.duplicateWarningTitle", {
                            defaultValue:
                              "This name looks similar to existing vendors.",
                          })}
                        </p>
                        <ul className="space-y-0.5">
                          {nearMatches.map((m) => (
                            <li key={m.id}>
                              {t("vendors.duplicateWarningSuggestion", {
                                defaultValue: "Did you mean ",
                              })}
                              <Link
                                href={`/vendors/${m.id}`}
                                className="font-semibold underline hover:text-amber-700"
                                data-testid={`link-duplicate-vendor-${m.id}`}
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
                            data-testid="checkbox-confirm-different-vendor"
                            checked={confirmDifferent}
                            onCheckedChange={(c) => setConfirmDifferent(c === true)}
                          />
                          <span>
                            {t("vendors.duplicateConfirmLabel", {
                              defaultValue:
                                "I'm sure this is a different vendor — create it anyway.",
                            })}
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                ) : null}
                {matchesLoading && matches.length === 0 && form.name.trim().length >= 3 && (
                  <p className="mt-1 text-xs text-muted-foreground" data-testid="vendor-match-loading">
                    {t("vendors.duplicateChecking", { defaultValue: "Checking for similar vendors…" })}
                  </p>
                )}
              </div>
              <div><Label>{t("vendors.contactName")}</Label><Input data-testid="input-contact-name" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} required /></div>
              <div><Label>{t("vendors.contactEmail")}</Label><Input data-testid="input-contact-email" type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} required /></div>
              <div><Label>{t("vendors.contactPhone")}</Label><Input data-testid="input-contact-phone" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: handlePhoneInput(e.target.value) })} /></div>
              <div><Label>{t("vendors.physicalAddress")}</Label><Input data-testid="input-physical-address" value={form.physicalAddress} onChange={(e) => setForm({ ...form, physicalAddress: e.target.value })} placeholder={t("vendors.addressPlaceholder")} /></div>
              <div><Label>{t("vendors.billingAddress")}</Label><Input data-testid="input-billing-address" value={form.billingAddress} onChange={(e) => setForm({ ...form, billingAddress: e.target.value })} placeholder={t("vendors.addressPlaceholder")} /></div>
              <PngPillButton color="blue" type="submit" disabled={submitDisabled} data-testid="button-submit-vendor" className="w-full">{createVendor.isPending ? t("vendors.creating") : t("vendors.createVendor")}</PngPillButton>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap items-center gap-3" data-testid="recon-alert-toolbar">
        <Label htmlFor="recon-alert-filter" className="text-sm text-muted-foreground">
          {t("vendors.reconAlertFilterLabel", { defaultValue: "Drift alerts" })}
        </Label>
        <Select value={reconAlertFilter} onValueChange={(v) => setReconAlertFilter(v as "all" | "on" | "off")}>
          <SelectTrigger id="recon-alert-filter" className="w-40" data-testid="select-recon-alert-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" data-testid="recon-filter-all">{t("vendors.reconAlertFilterAll", { defaultValue: "All vendors" })}</SelectItem>
            <SelectItem value="on" data-testid="recon-filter-on">{t("vendors.reconAlertFilterOn", { defaultValue: "Alerts on" })}</SelectItem>
            <SelectItem value="off" data-testid="recon-filter-off">{t("vendors.reconAlertFilterOff", { defaultValue: "Alerts off" })}</SelectItem>
          </SelectContent>
        </Select>
        {visibleSelectedIds.length > 0 && (
          <PngPillButton color="blue"
            type="button"
            onClick={handleBulkEnable}
            disabled={bulkEnabling}
            data-testid="button-bulk-enable-recon"
          >
            {bulkEnabling
              ? t("vendors.bulkEnableReconPending", {
                  count: visibleSelectedIds.length,
                  defaultValue: `Enabling… (${visibleSelectedIds.length})`,
                })
              : t("vendors.bulkEnableRecon", {
                  count: visibleSelectedIds.length,
                  defaultValue: `Enable drift alerts (${visibleSelectedIds.length})`,
                })}
          </PngPillButton>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : vendors && vendors.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    {eligibleForBulkEnable.length > 0 ? (
                      <Checkbox
                        data-testid="checkbox-select-all-recon"
                        aria-label={t("vendors.bulkEnableSelectAll", { defaultValue: "Select all vendors with drift alerts off" })}
                        checked={allEligibleSelected}
                        onCheckedChange={(c) => toggleSelectAllEligible(c === true)}
                      />
                    ) : null}
                  </TableHead>
                  <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort("name")}><div className="flex items-center gap-1.5">{t("vendors.company", { defaultValue: "Company" })} {sortIcon("name")}</div></TableHead>
                  <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort("contact")}><div className="flex items-center gap-1.5">{t("partners.contact", { defaultValue: "Contact" })} {sortIcon("contact")}</div></TableHead>
                  <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort("email")}><div className="flex items-center gap-1.5">{t("common.email")} {sortIcon("email")}</div></TableHead>
                  <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort("phone")}><div className="flex items-center gap-1.5">{t("common.phone")} {sortIcon("phone")}</div></TableHead>
                  <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort("reconAlerts")}><div className="flex items-center gap-1.5">{t("vendors.reconAlertColumn", { defaultValue: "Drift alerts" })} {sortIcon("reconAlerts")}</div></TableHead>
                  <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort("created")}><div className="flex items-center gap-1.5">{t("tickets.created")} {sortIcon("created")}</div></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedVendors!.map((v) => {
                  const primary = v.brandPrimaryColor || null;
                  const accent = v.brandAccentColor || null;
                  return (
                  <TableRow
                    key={v.id}
                    data-testid={`row-vendor-${v.id}`}
                    style={primary ? { boxShadow: `inset 4px 0 0 0 ${primary}`, ["--row-brand-primary" as string]: primary } as React.CSSProperties : undefined}
                  >
                    <TableCell className="w-10">
                      {!v.accountingReconciliationNotificationsEnabled ? (
                        <Checkbox
                          data-testid={`checkbox-recon-${v.id}`}
                          aria-label={t("vendors.bulkEnableSelectRow", { defaultValue: "Select {{name}} for bulk enable", name: v.name })}
                          checked={selectedIds.has(v.id)}
                          onCheckedChange={(c) => toggleSelectVendor(v.id, c === true)}
                        />
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Link href={`/vendors/${v.id}`} className="font-medium text-gray-700 hover:text-[var(--row-brand-primary,var(--brand-primary))] transition-colors" data-testid={`link-vendor-${v.id}`}>
                        <div className="flex items-center gap-2">
                          <VendorRowLogo
                            logoUrl={v.logoUrl}
                            logoSquareUrl={v.logoSquareUrl}
                            name={v.name}
                            vendorId={v.id}
                            altText={t("vendors.logoAlt", { defaultValue: "{{name}} logo", name: v.name })}
                            primaryColor={primary}
                            fallbackColor={accentColor}
                          />
                          {v.name}
                          {(primary || accent) && (
                            <span
                              className="inline-flex items-center gap-1 ml-1"
                              data-testid={`brand-swatches-vendor-${v.id}`}
                              aria-hidden="true"
                            >
                              {primary && (
                                <span
                                  className="inline-block w-3 h-3 rounded-sm border border-border"
                                  style={{ backgroundColor: primary }}
                                  data-testid={`swatch-primary-vendor-${v.id}`}
                                />
                              )}
                              {accent && (
                                <span
                                  className="inline-block w-3 h-3 rounded-sm border border-border"
                                  style={{ backgroundColor: accent }}
                                  data-testid={`swatch-accent-vendor-${v.id}`}
                                />
                              )}
                            </span>
                          )}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>{v.contactName}</TableCell>
                    <TableCell>{v.contactEmail}</TableCell>
                    <TableCell>{v.contactPhone ? formatPhone(v.contactPhone) : "-"}</TableCell>
                    <TableCell>
                      {v.accountingReconciliationNotificationsEnabled ? (
                        <span
                          data-testid={`recon-status-${v.id}`}
                          data-recon-enabled="true"
                          className="inline-flex items-center h-[23px] gap-1 rounded-full bg-emerald-50 px-3 text-xs font-normal text-emerald-800 border border-emerald-200"
                        >
                          <BellRing className="w-3 h-3" />
                          {t("vendors.reconAlertStatusOn", { defaultValue: "On" })}
                        </span>
                      ) : (
                        <span
                          data-testid={`recon-status-${v.id}`}
                          data-recon-enabled="false"
                          className="inline-flex items-center h-[23px] gap-1 rounded-full bg-muted px-3 text-xs font-normal text-muted-foreground border border-border"
                        >
                          <BellOff className="w-3 h-3" />
                          {t("vendors.reconAlertStatusOff", { defaultValue: "Off" })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{new Date(v.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="p-12 text-center text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>{t("vendors.empty", { defaultValue: "No vendors yet. Add your first vendor to get started." })}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
