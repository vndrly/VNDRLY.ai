import { CardHeading } from "@/components/ui/card-heading";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { MarketplaceRankedVendor } from "@workspace/api-client-react";
import { PngPillButton as TogglePillButton } from "@/components/png-pill-rollover";
import ImagePill from "@/components/image-pill";

const reasonKeys: Record<string, string> = {
  UNAUTHORIZED: "marketplace.reasons.unauthorized",
  COMPANY_INACTIVE: "marketplace.reasons.companyInactive",
  CAPABILITY_INACTIVE: "marketplace.reasons.capabilityInactive",
  SERVICE_MATCH_INACTIVE: "marketplace.reasons.matchInactive",
  OFFER_INACTIVE: "marketplace.reasons.offerInactive",
  SERVICE_AREA_MISSING: "marketplace.reasons.areaMissing",
  SERVICE_AREA_AMBIGUOUS: "marketplace.reasons.areaAmbiguous",
  SERVICE_AREA_INVALID: "marketplace.reasons.areaInvalid",
  SITE_COORDINATES_INVALID: "marketplace.reasons.siteInvalid",
  COMPLIANCE_STALE: "marketplace.reasons.compliance",
  CREDENTIAL_MISSING: "marketplace.reasons.credentials",
  INSUFFICIENT_CAPACITY: "marketplace.reasons.capacity",
  UNAVAILABLE: "marketplace.reasons.unavailable",
  RELATIONSHIP_REQUIRED: "marketplace.reasons.relationship",
  RELATIONSHIP_RESTRICTED: "marketplace.reasons.relationshipRestricted",
};

export default function VendorComparisonCard({
  vendor,
  compared,
  onCompare,
  onOffer,
  onDetails,
}: {
  vendor: MarketplaceRankedVendor;
  compared: boolean;
  onCompare: () => void;
  onOffer: () => void;
  onDetails: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const facts = vendor.eligibility.facts;
  const unknown = t("partnerMarketplace.notYetRated");
  // Explicit fields only: never stringify records or render internal evidence.
  return (
    <section data-card-layout
      className="rounded border bg-background p-4 space-y-3"
      aria-label={vendor.vendorName}
    >
      <div data-card-header-row className="flex flex-wrap items-center justify-between gap-2">
        <CardHeading as="h4" className="font-semibold">{vendor.vendorName}</CardHeading>
        <ImagePill color={vendor.eligibility.eligible ? "green" : "amber"}>
          {vendor.eligibility.eligible
            ? t("partnerMarketplace.eligible")
            : vendor.eligibility.reasonCodes.includes("OUT_OF_SERVICE_AREA")
              ? t("partnerMarketplace.outOfArea")
              : t("partnerMarketplace.ineligible")}
        </ImagePill>
      </div>
      <p>{vendor.capabilityName}</p>
      <p className="text-sm">{vendor.matchExplanation}</p>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt>{t("partnerMarketplace.price")}</dt>
          <dd>
            {vendor.offer.currency} {vendor.offer.unitPrice.toFixed(2)} /{" "}
            {vendor.offer.unit}
          </dd>
        </div>
        <div>
          <dt>{t("partnerMarketplace.rating")}</dt>
          <dd>
            {vendor.rating === null
              ? unknown
              : t("partnerMarketplace.ratingValue", {
                  rating: vendor.rating,
                  count: vendor.reviewCount,
                })}
          </dd>
        </div>
        <div>
          <dt>{t("partnerMarketplace.vndrlySafety")}</dt>
          <dd>
            {vendor.safetyStatus === "unavailable"
              ? t("partnerMarketplace.complianceUnavailable")
              : vendor.safety === null
                ? unknown
              : <><ImagePill color={vendor.safety.score < 60 ? "red" : vendor.safety.score < 85 ? "amber" : "green"} aria-label={t("partnerMarketplace.scoreValue", { score: vendor.safety.score })}>{vendor.safety.score} / 100</ImagePill><span>{vendor.safety.source} · {new Date(vendor.safety.refreshedAt).toISOString().slice(0, 10)}</span>{vendor.safety.reasons.map((reason) => <span className="block" key={reason}>{t(`partnerMarketplace.scoreReasons.${reason}`)}</span>)}</>}
          </dd>
        </div>
        <div>
          <dt>{t("partnerMarketplace.distance")}</dt>
          <dd>
            {facts.distanceMiles === null || facts.radiusMiles === null
              ? t("partnerMarketplace.unknown")
              : t("partnerMarketplace.distanceValue", {
                  distance: facts.distanceMiles,
                  radius: facts.radiusMiles,
                })}
          </dd>
        </div>
        <div>
          <dt>{t("partnerMarketplace.history")}</dt>
          <dd>
            {t("partnerMarketplace.completedJobs", {
              count: vendor.completedJobs,
            })}
          </dd>
          <dd>
            {vendor.onTimeRate === null
              ? t("partnerMarketplace.onTimeUnknown")
              : t("partnerMarketplace.onTimeValue", {
                  percent: Math.round(vendor.onTimeRate * 100),
                })}
          </dd>
          <dd>
            {t("partnerMarketplace.priorJobs", {
              count: vendor.priorPartnerJobs,
            })}
          </dd>
        </div>
        <div>
          <dt>{t("partnerMarketplace.compliance")}</dt>
          <dd>
            {t(
              vendor.complianceCurrent
                ? "partnerMarketplace.complianceCurrent"
                : "partnerMarketplace.complianceRequired",
            )}
          </dd>
          {facts.missingCredentials.length > 0 && (
            <dd>
              {t("partnerMarketplace.missingCredentials")}:{" "}
              {facts.missingCredentials.join(", ")}
            </dd>
          )}
        </div>
        <div>
          <dt>{t("partnerMarketplace.availability")}</dt>
          <dd>
            {vendor.offer.available
              ? t("partnerMarketplace.capacityValue", {
                  count: facts.availableCapacity,
                })
              : t("partnerMarketplace.unavailable")}
          </dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">
        {t("partnerMarketplace.advisoryHiring")}
      </p>
      {vendor.offer.commercialConditions && (
        <p className="text-sm">{vendor.offer.commercialConditions}</p>
      )}
      {vendor.eligibility.reasonCodes
        .filter((code) => code !== "OUT_OF_SERVICE_AREA")
        .map((code) => (
          <p key={code} className="text-sm">
            {t(reasonKeys[code] ?? "partnerMarketplace.ineligible")}
          </p>
        ))}
      <details>
        <summary>{t("partnerMarketplace.whyRanked")}</summary>
        <ul className="list-disc pl-5 text-sm">
          {vendor.factors.map((factor) => (
            <li key={factor.name}>
              {t(`partnerMarketplace.sort.${factor.name}`)}:{" "}
              {factor.status === "available"
                ? factor.explanation
                : t(
                    factor.status === "not_yet_rated"
                      ? "partnerMarketplace.notYetRated"
                      : "partnerMarketplace.notComparable",
                  )}
            </li>
          ))}
        </ul>
      </details>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={id} className="text-sm">
          <input
            id={id}
            type="checkbox"
            checked={compared}
            onChange={onCompare}
          />{" "}
          {t("partnerMarketplace.compareVendor", { name: vendor.vendorName })}
        </label>
        <TogglePillButton type="button" color="blue" onClick={onDetails}>
          {t("partnerMarketplace.details")}
        </TogglePillButton>
        <TogglePillButton
          type="button"
          color="blue"
          disabled={!vendor.offerable || !vendor.eligibility.eligible}
          onClick={onOffer}
        >
          {t("partnerMarketplace.prepareOffer")}
        </TogglePillButton>
      </div>
    </section>
  );
}
