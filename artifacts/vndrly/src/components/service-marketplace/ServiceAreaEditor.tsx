import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  useListVendorMarketplaceServiceAreas,
  useSaveVendorMarketplaceServiceArea,
  useClearVendorMarketplaceServiceAreaOverride,
  getListVendorMarketplaceServiceAreasQueryKey,
  getListVendorMarketplaceMatchingDemandQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { PngPillButton } from "@/components/png-pill-rollover";
import { getApiErrorCode, translateApiError } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { hotlistApi } from "@/lib/hotlist-api";

export type ServiceAreaDraft = {
  company: string | null;
  service: string | null;
  override: boolean | null;
};

export function validServiceRadius(value: string): boolean {
  const radius = Number(value);
  return (
    !!value.trim() &&
    Number.isFinite(radius) &&
    radius > 0 &&
    radius <= 20000 &&
    Math.abs(radius * 1000 - Math.round(radius * 1000)) <= 0.000001
  );
}

/** Coordinates are read-only saved facts. Only radius and own capability identity are submitted. */
export default function ServiceAreaEditor({
  vendorId,
  capabilityId,
  draftCache,
  creating = false,
  disabled = false,
  onSaved,
}: {
  vendorId: number;
  capabilityId?: number;
  draftCache: Map<string, ServiceAreaDraft>;
  creating?: boolean;
  disabled?: boolean;
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const areas = useListVendorMarketplaceServiceAreas(vendorId);
  const base = useQuery({
    queryKey: ["hotlist", "operating-area", vendorId],
    queryFn: () => hotlistApi.getOperatingArea(vendorId),
  });
  const company = areas.data?.items.find(
    (a) => a.active && !a.effectiveUntil && a.vendorCapabilityId === null,
  );
  const service = areas.data?.items.find(
    (a) =>
      a.active && !a.effectiveUntil && a.vendorCapabilityId === capabilityId,
  );
  const cacheKey = `${vendorId}:${creating ? "new" : (capabilityId ?? "company")}`;
  const cached = draftCache.get(cacheKey);
  const [companyDraft, setCompanyDraft] = useState<string | null>(
    cached?.company ?? null,
  );
  const [serviceDraft, setServiceDraft] = useState<string | null>(
    cached?.service ?? null,
  );
  const [overrideDraft, setOverrideDraft] = useState<boolean | null>(
    cached?.override ?? null,
  );
  useEffect(() => {
    draftCache.set(cacheKey, {
      company: companyDraft,
      service:
        serviceDraft ??
        ((overrideDraft ?? !!service)
          ? (service?.radiusMiles ?? company?.radiusMiles ?? null)
          : null),
      override: overrideDraft,
    });
  }, [
    draftCache,
    cacheKey,
    companyDraft,
    serviceDraft,
    overrideDraft,
    service?.radiusMiles,
    company?.radiusMiles,
  ]);
  const [error, setError] = useState<string | null>(null);
  const mutation = useSaveVendorMarketplaceServiceArea();
  const clear = useClearVendorMarketplaceServiceAreaOverride();
  const refreshCoverage = () =>
    Promise.all([
      qc.invalidateQueries({
        queryKey: getListVendorMarketplaceServiceAreasQueryKey(vendorId),
      }),
      qc.invalidateQueries({
        queryKey: getListVendorMarketplaceMatchingDemandQueryKey(vendorId),
      }),
    ]);
  const inherit = async () => {
    if (!capabilityId) return;
    setError(null);
    try {
      await clear.mutateAsync({ vendorId, capabilityId });
      await refreshCoverage();
      setOverrideDraft(false);
      setServiceDraft(null);
      toast({ title: t("marketplace.coverageSaved") });
      onSaved?.();
    } catch (e) {
      setError(translateApiError(e, t, t("marketplace.saveError")));
    }
  };
  const current = base.data;
  const verified =
    !!current?.physicalAddress?.trim() &&
    !!current.geocodedAt &&
    Number.isFinite(Date.parse(current.geocodedAt)) &&
    Date.parse(current.geocodedAt) <= Date.now() &&
    typeof current.latitude === "number" &&
    Number.isFinite(current.latitude) &&
    Math.abs(current.latitude) <= 90 &&
    typeof current.longitude === "number" &&
    Number.isFinite(current.longitude) &&
    Math.abs(current.longitude) <= 180 &&
    !(current.latitude === 0 && current.longitude === 0);
  const companyRadius = companyDraft ?? company?.radiusMiles ?? "";
  const serviceRadius =
    serviceDraft ?? service?.radiusMiles ?? company?.radiusMiles ?? "";
  const override = overrideDraft ?? !!service;
  const save = async (id: number | null, value: string) => {
    const radiusMiles = Number(value);
    if (!validServiceRadius(value)) {
      setError(t("marketplace.radiusInvalid"));
      return;
    }
    if (!verified) {
      setError(t("marketplace.baseInvalid"));
      return;
    }
    setError(null);
    try {
      await mutation.mutateAsync({
        vendorId,
        data: { vendorCapabilityId: id, radiusMiles },
      });
      await refreshCoverage();
      toast({ title: t("marketplace.coverageSaved") });
      onSaved?.();
    } catch (e) {
      setError(
        getApiErrorCode(e) === "marketplace.verified_service_base_required"
          ? t("marketplace.baseInvalid")
          : translateApiError(e, t, t("marketplace.saveError")),
      );
    }
  };
  return (
    <fieldset
      className="space-y-3 border rounded p-4"
      disabled={disabled || mutation.isPending || clear.isPending}
    >
      <legend className="px-1 font-semibold">
        {t("marketplace.coverage")}
      </legend>
      {base.isPending || areas.isPending ? (
        <p role="status">{t("marketplace.loading")}</p>
      ) : base.isError || areas.isError ? (
        <p role="alert">{t("marketplace.loadError")}</p>
      ) : (
        <>
          <p className="text-sm">
            {t("marketplace.serviceBase")}:{" "}
            {current?.physicalAddress || t("marketplace.noBase")}
          </p>
          {!verified && <p role="alert">{t("marketplace.baseInvalid")}</p>}
          <a
            className="text-sm underline"
            href={`${import.meta.env.BASE_URL}vendors/${vendorId}`}
          >
            {t("marketplace.verifyBase")}
          </a>
          {company && (
            <p className="text-sm">
              {t("marketplace.companyDefault", { radius: company.radiusMiles })}
            </p>
          )}
          <label className="block text-sm">
            {t("marketplace.companyRadius")}
            <Input
              type="number"
              min="0.001"
              max="20000"
              step="0.001"
              value={companyRadius}
              onChange={(e) => setCompanyDraft(e.target.value)}
            />
          </label>
          <PngPillButton
            color="blue"
            disabled={!verified}
            onClick={() => void save(null, companyRadius)}
          >
            {t("marketplace.saveCompanyCoverage")}
          </PngPillButton>
          {(capabilityId || creating) && (
            <>
              <label className="flex gap-2 text-sm items-center">
                <input
                  type="checkbox"
                  checked={override}
                  disabled={!!service}
                  onChange={(e) => setOverrideDraft(e.target.checked)}
                />
                {t("marketplace.overrideCoverage")}
              </label>
              {!override && (
                <p className="text-sm text-muted-foreground">
                  {company
                    ? t("marketplace.inheritedCoverage")
                    : t("marketplace.companyCoverageRequired")}
                </p>
              )}
              {override && (
                <>
                  <label className="block text-sm">
                    {t("marketplace.serviceRadius")}
                    <Input
                      type="number"
                      min="0.001"
                      max="20000"
                      step="0.001"
                      value={serviceRadius}
                      onChange={(e) => setServiceDraft(e.target.value)}
                    />
                  </label>
                  {service && (
                    <>
                      <p className="text-xs text-muted-foreground">
                        {t("marketplace.savedOverride")}
                      </p>
                      <PngPillButton
                        color="blue"
                        onClick={() => void inherit()}
                      >
                        {t("marketplace.useCompanyCoverage")}
                      </PngPillButton>
                    </>
                  )}
                  {capabilityId ? (
                    <PngPillButton
                      color="blue"
                      disabled={!verified}
                      onClick={() => void save(capabilityId, serviceRadius)}
                    >
                      {t("marketplace.saveServiceCoverage")}
                    </PngPillButton>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("marketplace.stagedCoverage")}
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
