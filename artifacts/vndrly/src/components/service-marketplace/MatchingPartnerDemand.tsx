import { CardHeading } from "@/components/ui/card-heading";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  useListVendorMarketplacePartnerRates,
  useSaveVendorMarketplacePartnerRate,
  getListVendorMarketplacePartnerRatesQueryKey,
  getListVendorMarketplaceMatchingDemandQueryKey,
  type MarketplaceCapability,
  type MarketplaceDemand,
  type MarketplacePartnerRate,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PngPillButton } from "@/components/png-pill-rollover";
import { translateApiError } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";

const reasonKeys = {
  UNAUTHORIZED: "marketplace.reasons.unauthorized",
  COMPANY_INACTIVE: "marketplace.reasons.companyInactive",
  CAPABILITY_INACTIVE: "marketplace.reasons.capabilityInactive",
  SERVICE_MATCH_INACTIVE: "marketplace.reasons.matchInactive",
  OFFER_INACTIVE: "marketplace.reasons.offerInactive",
  SERVICE_AREA_MISSING: "marketplace.reasons.areaMissing",
  SERVICE_AREA_AMBIGUOUS: "marketplace.reasons.areaAmbiguous",
  SERVICE_AREA_INVALID: "marketplace.reasons.areaInvalid",
  SITE_COORDINATES_INVALID: "marketplace.reasons.siteInvalid",
  OUT_OF_SERVICE_AREA: "marketplace.reasons.outside",
  COMPLIANCE_STALE: "marketplace.reasons.compliance",
  CREDENTIAL_MISSING: "marketplace.reasons.credentials",
  INSUFFICIENT_CAPACITY: "marketplace.reasons.capacity",
  UNAVAILABLE: "marketplace.reasons.unavailable",
  RELATIONSHIP_REQUIRED: "marketplace.reasons.relationship",
  RELATIONSHIP_RESTRICTED: "marketplace.reasons.relationshipRestricted",
} as const;

export type PartnerRateDraft = {
  price: string;
  unit: string;
  currency: string;
  notes: string;
  conditions: string;
  capacity: string;
  available: boolean;
};

function PartnerRate({
  vendorId,
  item,
  capability,
  offer,
  draftCache,
}: {
  vendorId: number;
  item: MarketplaceDemand;
  capability: MarketplaceCapability;
  offer?: MarketplacePartnerRate | null;
  draftCache: Map<string, PartnerRateDraft>;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const initial = offer ?? item.ownOffer;
  const cacheKey = `${vendorId}:${capability.id}:${item.workTypeId}`;
  const cached = draftCache.get(cacheKey);
  // User-owned state survives background readback and saves in other partner rows.
  const [price, setPrice] = useState(
    cached?.price ??
      initial?.unitPrice ??
      String(capability.defaultRateCard?.unitPrice ?? ""),
  );
  const [unit, setUnit] = useState(
    cached?.unit ??
      initial?.unit ??
      capability.defaultRateCard?.unit ??
      capability.defaultUnit ??
      "per_hour",
  );
  const [currency, setCurrency] = useState(
    cached?.currency ??
      initial?.currency ??
      capability.defaultRateCard?.currency ??
      "USD",
  );
  const [notes, setNotes] = useState(cached?.notes ?? initial?.notes ?? "");
  const [conditions, setConditions] = useState(
    cached?.conditions ?? initial?.commercialConditions ?? "",
  );
  const [capacity, setCapacity] = useState(
    cached?.capacity ?? String(initial?.capacity ?? capability.capacity),
  );
  const [available, setAvailable] = useState(
    cached?.available ?? initial?.availability?.available !== false,
  );
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    draftCache.set(cacheKey, {
      price,
      unit,
      currency,
      notes,
      conditions,
      capacity,
      available,
    });
  }, [
    draftCache,
    cacheKey,
    price,
    unit,
    currency,
    notes,
    conditions,
    capacity,
    available,
  ]);
  const mutation = useSaveVendorMarketplacePartnerRate();
  const save = async () => {
    const unitPrice = Number(price);
    const crews = Number(capacity);
    if (
      !/^\d+(\.\d{1,2})?$/.test(price.trim()) ||
      !Number.isFinite(unitPrice) ||
      unitPrice > 9999999999.99 ||
      !unit.trim() ||
      unit.length > 50 ||
      !/^[A-Z]{3}$/.test(currency) ||
      !Number.isInteger(crews) ||
      crews < 1 ||
      crews > 100000
    ) {
      setError(t("marketplace.rateInvalid"));
      return;
    }
    setError(null);
    try {
      await mutation.mutateAsync({
        vendorId,
        data: {
          vendorCapabilityId: capability.id,
          workTypeId: item.workTypeId,
          unitPrice,
          unit,
          currency,
          notes: notes.trim() || null,
          commercialConditions: conditions.trim() || null,
          capacity: crews,
          availability: { available },
          active: true,
          ...(initial?.rateComponents
            ? { rateComponents: initial.rateComponents }
            : {}),
        },
      });
      await Promise.all([
        qc.invalidateQueries({
          queryKey: getListVendorMarketplacePartnerRatesQueryKey(vendorId),
        }),
        qc.invalidateQueries({
          queryKey: getListVendorMarketplaceMatchingDemandQueryKey(vendorId),
        }),
      ]);
      toast({ title: t("marketplace.rateSaved") });
    } catch (e) {
      setError(translateApiError(e, t, t("marketplace.saveError")));
    }
  };
  const units = Array.from(
    new Set(["per_hour", "per_day", "per_job", "lump_sum", unit]),
  );
  return (
    <section aria-label={`${item.partnerName} — ${item.name}`}>
      <Card>
        <CardContent className="p-4 space-y-3">
          <CardHeading as="h4" className="font-semibold">
            {item.partnerName} — {item.name}
          </CardHeading>
          {item.description && <p className="text-sm">{item.description}</p>}
          <p className="text-sm">
            {t("marketplace.requirements")}:{" "}
            {item.requiredCertifications.length
              ? item.requiredCertifications.join(", ")
              : t("marketplace.noneListed")}
          </p>
          <p className="text-sm">
            {t("marketplace.locations")}:{" "}
            {item.locations
              .map(
                (location) =>
                  location.state ?? t("marketplace.locationUnavailable"),
              )
              .join(", ") || t("marketplace.locationUnavailable")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("marketplace.approximateDemand", {
              count: item.approximateDemand,
            })}
          </p>
          {item.eligibility.eligible ? (
            <p className="text-sm">{t("marketplace.eligible")}</p>
          ) : (
            <ul className="text-sm list-disc pl-5">
              {item.eligibility.reasonCodes.map((reason) => (
                <li key={reason}>{t(reasonKeys[reason])}</li>
              ))}
            </ul>
          )}
          <fieldset className="space-y-3" disabled={mutation.isPending}>
            <legend className="font-medium">{t("marketplace.yourRate")}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm">
                {t("marketplace.price")}
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </label>
              <label className="text-sm">
                {t("marketplace.unit")}
                <select
                  className="block w-full rounded border bg-background p-2"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                >
                  {units.map((value) => (
                    <option key={value} value={value}>
                      {["per_hour", "per_day", "per_job", "lump_sum"].includes(
                        value,
                      )
                        ? t(`vendorCatalog.units.${value}`)
                        : value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                {t("marketplace.currency")}
                <Input
                  maxLength={3}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                />
              </label>
              <label className="text-sm">
                {t("marketplace.crews")}
                <Input
                  type="number"
                  min="1"
                  max="100000"
                  step="1"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                />
              </label>
            </div>
            <label className="flex gap-2 items-center text-sm">
              <input
                type="checkbox"
                checked={available}
                onChange={(e) => setAvailable(e.target.checked)}
              />
              {t("marketplace.available")}
            </label>
            <label className="block text-sm">
              {t("marketplace.notes")}
              <Textarea
                maxLength={2000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              {t("marketplace.conditions")}
              <Textarea
                maxLength={2000}
                value={conditions}
                onChange={(e) => setConditions(e.target.value)}
              />
            </label>
            <PngPillButton color="blue" onClick={() => void save()}>
              {mutation.isPending
                ? t("marketplace.saving")
                : t("marketplace.savePartnerRate")}
            </PngPillButton>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export default function MatchingPartnerDemand({
  vendorId,
  capability,
  items,
  draftCache,
}: {
  vendorId: number;
  capability: MarketplaceCapability;
  items: MarketplaceDemand[];
  draftCache: Map<string, PartnerRateDraft>;
}) {
  const { t } = useTranslation();
  const rates = useListVendorMarketplacePartnerRates(vendorId);
  return (
    <div className="space-y-3">
      <h3 className="font-semibold">{t("marketplace.matchingPartners")}</h3>
      <p className="text-sm text-muted-foreground">
        {t("marketplace.discoveryHelp")}
      </p>
      {rates.isPending ? (
        <p role="status">{t("marketplace.loading")}</p>
      ) : rates.isError ? (
        <p role="alert">{t("marketplace.loadError")}</p>
      ) : (
        items.map((item) => (
          <PartnerRate
            key={`${item.capabilityId}:${item.workTypeId}`}
            vendorId={vendorId}
            capability={capability}
            item={item}
            draftCache={draftCache}
            offer={rates.data.items.find(
              (rate) =>
                rate.active &&
                !rate.effectiveUntil &&
                rate.vendorCapabilityId === capability.id &&
                rate.workTypeId === item.workTypeId,
            )}
          />
        ))
      )}
    </div>
  );
}
