import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useGetVendor,
  useGetPartner,
  getGetVendorQueryKey,
  getGetPartnerQueryKey,
} from "@workspace/api-client-react";
import {
  INVOICE_LINE_TYPES,
  INVOICE_LINE_INCOME_CATEGORIES,
  type InvoiceLineType,
  type InvoiceLineIncomeCategory,
  type LateFeeRule,
} from "@workspace/db/schema";
import { Save } from "lucide-react";
import SphereBackButton from "@/components/sphere-back-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PngPillButton } from "@/components/png-pill-rollover";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/api-error";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const USE_DEFAULT = "__default__";

// Mirrors `defaultIncomeCategoryForLineType` in
// artifacts/api-server/src/lib/invoice-engine.ts so the UI can show what the
// engine would pick when a row is left on "use default". Keep these in sync.
function engineDefaultFor(lineType: InvoiceLineType): InvoiceLineIncomeCategory {
  switch (lineType) {
    case "labor_regular":
    case "labor_overtime":
    case "materials":
    case "markup":
    case "other":
      return "nec";
    case "equipment":
      return "misc_rents";
    case "mileage":
    case "per_diem":
    case "discount":
      return "none";
  }
}

type SettingsRow = {
  id: number;
  vendorId: number;
  partnerId: number;
  defaultIncomeCategoryOverrides: Partial<
    Record<InvoiceLineType, InvoiceLineIncomeCategory>
  > | null;
  lateFeeRule: LateFeeRule | null;
};

// Local-state shape for the late-fee editor. Decoupled from the wire
// `LateFeeRule` so the user can switch between flat/percent/none without
// losing the values they typed in the inactive panel until they save.
type LateFeeDraft = {
  kind: "none" | "flat" | "percent";
  amount: string; // flat
  rate: string; // percent (1.50 = 1.50%)
  afterDays: string;
};

const DEFAULT_LATE_FEE_DRAFT: LateFeeDraft = {
  kind: "none",
  amount: "",
  rate: "",
  afterDays: "0",
};

function ruleToDraft(rule: LateFeeRule | null | undefined): LateFeeDraft {
  if (!rule || rule.kind === "none") return { ...DEFAULT_LATE_FEE_DRAFT };
  if (rule.kind === "flat") {
    return {
      kind: "flat",
      amount: rule.amount,
      rate: "",
      afterDays: String(rule.afterDays),
    };
  }
  return {
    kind: "percent",
    amount: "",
    rate: rule.rate,
    afterDays: String(rule.afterDays),
  };
}

// Build the wire payload from the draft, validating shape. Returns
// either a LateFeeRule, the literal `null` (treat as "no rule" — clear
// the column), or the string "invalid" so the caller can surface a
// validation toast without firing the mutation.
function draftToRule(draft: LateFeeDraft): LateFeeRule | null | "invalid" {
  if (draft.kind === "none") return { kind: "none" };
  const days = Number(draft.afterDays);
  if (!Number.isInteger(days) || days < 0 || days > 365) return "invalid";
  if (draft.kind === "flat") {
    if (!/^\d+(\.\d{1,2})?$/.test(draft.amount)) return "invalid";
    return { kind: "flat", amount: draft.amount, afterDays: days };
  }
  if (!/^\d+(\.\d{1,4})?$/.test(draft.rate)) return "invalid";
  return { kind: "percent", rate: draft.rate, afterDays: days };
}

async function fetchSettings(
  vendorId: number,
  partnerId: number,
): Promise<SettingsRow | null> {
  const res = await fetch(
    `${API_BASE}/api/vendor-partner-billing-settings?vendorId=${vendorId}&partnerId=${partnerId}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { settings: SettingsRow | null };
  return json.settings;
}

export default function BillingSettingsPage({
  vendorId,
  partnerId,
}: {
  vendorId: number;
  partnerId: number;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const isAdmin = user?.role === "admin";
  const isOwningVendor =
    user?.role === "vendor" && user?.vendorId === vendorId;
  // Partner admins of this partner org can also manage their 1099 overrides;
  // the API mirrors the same membership-role check on the PUT handler.
  const isOwningPartnerAdmin =
    user?.role === "partner" &&
    user?.partnerId === partnerId &&
    (user?.availableMemberships ?? []).some(
      (m) => m.orgType === "partner" && m.orgId === partnerId && m.role === "admin",
    );
  const canEdit = isAdmin || isOwningVendor || isOwningPartnerAdmin;

  const { data: vendor } = useGetVendor(vendorId, {
    query: { enabled: !!vendorId, queryKey: getGetVendorQueryKey(vendorId) },
  });
  const { data: partner } = useGetPartner(partnerId, {
    query: { enabled: !!partnerId, queryKey: getGetPartnerQueryKey(partnerId) },
  });

  const settingsQuery = useQuery({
    queryKey: ["vendor-partner-billing-settings", vendorId, partnerId],
    queryFn: () => fetchSettings(vendorId, partnerId),
    enabled: !!vendorId && !!partnerId,
  });

  // Local editor state: per line type, either a concrete category or
  // USE_DEFAULT meaning "fall back to the engine default".
  const [draft, setDraft] = useState<Record<InvoiceLineType, string>>(() => {
    const o: Record<InvoiceLineType, string> = {} as Record<
      InvoiceLineType,
      string
    >;
    for (const lt of INVOICE_LINE_TYPES) o[lt] = USE_DEFAULT;
    return o;
  });
  const [initialDraftJson, setInitialDraftJson] = useState<string>(() =>
    JSON.stringify(
      INVOICE_LINE_TYPES.reduce(
        (acc, lt) => ({ ...acc, [lt]: USE_DEFAULT }),
        {} as Record<InvoiceLineType, string>,
      ),
    ),
  );

  // Late-fee draft + a sticky baseline JSON for dirty-tracking. We rebuild
  // both whenever the server settings refetch so a successful save snaps the
  // baseline forward and the Save button re-disables until the next edit.
  const [lateFeeDraft, setLateFeeDraft] = useState<LateFeeDraft>(
    DEFAULT_LATE_FEE_DRAFT,
  );
  const [initialLateFeeJson, setInitialLateFeeJson] = useState<string>(() =>
    JSON.stringify(DEFAULT_LATE_FEE_DRAFT),
  );

  useEffect(() => {
    const overrides = settingsQuery.data?.defaultIncomeCategoryOverrides ?? {};
    const next: Record<InvoiceLineType, string> = {} as Record<
      InvoiceLineType,
      string
    >;
    for (const lt of INVOICE_LINE_TYPES) {
      const v = overrides[lt];
      next[lt] =
        v && (INVOICE_LINE_INCOME_CATEGORIES as readonly string[]).includes(v)
          ? v
          : USE_DEFAULT;
    }
    setDraft(next);
    setInitialDraftJson(JSON.stringify(next));

    const lfDraft = ruleToDraft(settingsQuery.data?.lateFeeRule);
    setLateFeeDraft(lfDraft);
    setInitialLateFeeJson(JSON.stringify(lfDraft));
  }, [settingsQuery.data]);

  const dirty = useMemo(
    () =>
      JSON.stringify(draft) !== initialDraftJson ||
      JSON.stringify(lateFeeDraft) !== initialLateFeeJson,
    [draft, initialDraftJson, lateFeeDraft, initialLateFeeJson],
  );

  const save = useMutation({
    mutationFn: async () => {
      // Build the merged map from the current draft. Any row left on "use
      // default" is omitted; an empty object means "clear all overrides".
      const overrides: Partial<
        Record<InvoiceLineType, InvoiceLineIncomeCategory>
      > = {};
      for (const lt of INVOICE_LINE_TYPES) {
        const v = draft[lt];
        if (v !== USE_DEFAULT) overrides[lt] = v as InvoiceLineIncomeCategory;
      }
      const lateFeeRule = draftToRule(lateFeeDraft);
      if (lateFeeRule === "invalid") {
        throw new Error(t("invoices.billingSettings.lateFee.invalid"));
      }
      const res = await fetch(
        `${API_BASE}/api/vendor-partner-billing-settings`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            vendorId,
            partnerId,
            defaultIncomeCategoryOverrides: overrides,
            lateFeeRule,
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }
      return json as { settings: SettingsRow };
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["vendor-partner-billing-settings", vendorId, partnerId],
      });
      toast({ title: t("invoices.billingSettings.savedToast") });
    },
    onError: (err: Error) =>
      toast({
        title: translateApiError(err, t, t("invoices.billingSettings.saveFailedToast")),
        variant: "destructive",
      }),
  });

  const backHref = `/vendors/${vendorId}`;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            href={backHref}
            className="group inline-flex items-center"
            data-testid="link-back-billing-settings"
            aria-label="Back"
          >
            <SphereBackButton size={32} />
          </Link>
          <div>
            <h1 className="text-2xl font-semibold">
              {t("invoices.billingSettings.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {vendor?.name ?? `Vendor #${vendorId}`}
              {" • "}
              {partner?.name ?? `Partner #${partnerId}`}
            </p>
          </div>
        </div>
      </div>

      <Card data-testid="card-income-category-overrides">
        <CardHeader>
          <CardTitle className="text-base">
            {t("invoices.billingSettings.overridesHeading")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("invoices.billingSettings.overridesHelper")}
          </p>
        </CardHeader>
        <CardContent>
          {settingsQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t("invoices.billingSettings.lineTypeColumn")}
                  </TableHead>
                  <TableHead>
                    {t("invoices.billingSettings.categoryColumn")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {INVOICE_LINE_TYPES.map((lt) => {
                  const def = engineDefaultFor(lt);
                  const value = draft[lt];
                  const showHint = value === USE_DEFAULT;
                  return (
                    <TableRow
                      key={lt}
                      data-testid={`row-line-type-${lt}`}
                    >
                      <TableCell className="font-medium align-top w-1/3">
                        {t(`invoices.lineType.${lt}`)}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={value}
                          disabled={!canEdit}
                          onValueChange={(v) =>
                            setDraft((cur) => ({ ...cur, [lt]: v }))
                          }
                        >
                          <SelectTrigger
                            className="w-full max-w-md"
                            data-testid={`select-override-${lt}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={USE_DEFAULT}>
                              {t("invoices.billingSettings.useDefault")}
                            </SelectItem>
                            {INVOICE_LINE_INCOME_CATEGORIES.map((c) => (
                              <SelectItem key={c} value={c}>
                                {t(`invoices.incomeCategory.${c}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {showHint && (
                          <p
                            className="text-xs text-muted-foreground mt-1"
                            data-testid={`text-engine-default-${lt}`}
                          >
                            {t("invoices.billingSettings.engineDefault", {
                              label: t(`invoices.incomeCategory.${def}`),
                            })}
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-late-fee-rule">
        <CardHeader>
          <CardTitle className="text-base">
            {t("invoices.billingSettings.lateFee.heading")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("invoices.billingSettings.lateFee.helper")}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {settingsQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <>
              <div className="space-y-2 max-w-xs">
                <Label htmlFor="late-fee-kind">
                  {t("invoices.billingSettings.lateFee.kindLabel")}
                </Label>
                <Select
                  value={lateFeeDraft.kind}
                  disabled={!canEdit}
                  onValueChange={(v) =>
                    setLateFeeDraft((cur) => ({
                      ...cur,
                      kind: v as LateFeeDraft["kind"],
                    }))
                  }
                >
                  <SelectTrigger
                    id="late-fee-kind"
                    data-testid="select-late-fee-kind"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      {t("invoices.billingSettings.lateFee.kind.none")}
                    </SelectItem>
                    <SelectItem value="flat">
                      {t("invoices.billingSettings.lateFee.kind.flat")}
                    </SelectItem>
                    <SelectItem value="percent">
                      {t("invoices.billingSettings.lateFee.kind.percent")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {lateFeeDraft.kind === "flat" && (
                <div className="space-y-2 max-w-xs">
                  <Label htmlFor="late-fee-amount">
                    {t("invoices.billingSettings.lateFee.amountLabel")}
                  </Label>
                  <Input
                    id="late-fee-amount"
                    inputMode="decimal"
                    value={lateFeeDraft.amount}
                    disabled={!canEdit}
                    placeholder="25.00"
                    onChange={(e) =>
                      setLateFeeDraft((cur) => ({
                        ...cur,
                        amount: e.target.value,
                      }))
                    }
                    data-testid="input-late-fee-amount"
                  />
                </div>
              )}

              {lateFeeDraft.kind === "percent" && (
                <div className="space-y-2 max-w-xs">
                  <Label htmlFor="late-fee-rate">
                    {t("invoices.billingSettings.lateFee.rateLabel")}
                  </Label>
                  <Input
                    id="late-fee-rate"
                    inputMode="decimal"
                    value={lateFeeDraft.rate}
                    disabled={!canEdit}
                    placeholder="1.50"
                    onChange={(e) =>
                      setLateFeeDraft((cur) => ({
                        ...cur,
                        rate: e.target.value,
                      }))
                    }
                    data-testid="input-late-fee-rate"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("invoices.billingSettings.lateFee.rateHelper")}
                  </p>
                </div>
              )}

              {lateFeeDraft.kind !== "none" && (
                <div className="space-y-2 max-w-xs">
                  <Label htmlFor="late-fee-after-days">
                    {t("invoices.billingSettings.lateFee.afterDaysLabel")}
                  </Label>
                  <Input
                    id="late-fee-after-days"
                    inputMode="numeric"
                    value={lateFeeDraft.afterDays}
                    disabled={!canEdit}
                    placeholder="0"
                    onChange={(e) =>
                      setLateFeeDraft((cur) => ({
                        ...cur,
                        afterDays: e.target.value,
                      }))
                    }
                    data-testid="input-late-fee-after-days"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("invoices.billingSettings.lateFee.afterDaysHelper")}
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <PngPillButton
          color="blue"
          onClick={() => save.mutate()}
          disabled={!canEdit || !dirty || save.isPending}
          attention={canEdit && dirty && !save.isPending}
          data-testid="button-save-billing-settings"
        >
          <Save className="w-4 h-4" />
          {save.isPending
            ? t("invoices.billingSettings.saving")
            : t("invoices.billingSettings.save")}
        </PngPillButton>
      </div>
    </div>
  );
}
