import { useTranslation } from "react-i18next";
import type { MarketplaceJobOffer } from "@workspace/api-client-react";

/** Explicit commercial projection: never render the complete server record/evidence. */
export default function JobOfferSummary({
  offer,
}: {
  offer: MarketplaceJobOffer;
}) {
  const { t } = useTranslation();
  const terms = offer.commercialSnapshot;
  const display = (value: unknown) =>
    typeof value === "string" || typeof value === "number"
      ? String(value)
      : "—";
  return (
    <div className="space-y-2 text-sm">
      <p>
        {t("jobOffers.identity", {
          offer: offer.id,
          partner: offer.partnerId,
          site: offer.siteLocationId,
          service: offer.workTypeId,
        })}
      </p>
      <p>{offer.scope}</p>
      {terms.gateContractor === true && <p>{t("partnerMarketplace.gateDesignation")}</p>}
      <p>
        {display(terms.currency)} {Number(terms.unitPrice).toFixed(2)} /{" "}
        {display(terms.unit)}
      </p>
      {terms.automaticBilling === "manual_billing_required" && (
        <p role="status">{t("jobOffers.manualBillingRequired")}</p>
      )}
      {terms.automaticBilling === "hourly_usd" &&
        terms.billingRules != null &&
        typeof terms.billingRules === "object" && (
          <p>
            {t(
              "jobOffers.overtimeTerms",
              terms.billingRules as Record<string, unknown>,
            )}
          </p>
        )}
      {terms.rateComponents != null &&
        typeof terms.rateComponents === "object" &&
        Object.keys(terms.rateComponents).length > 0 && (
          <div>
            <p>{t("jobOffers.rateComponents")}</p>
            <pre className="whitespace-pre-wrap">
              {JSON.stringify(terms.rateComponents, null, 2)}
            </pre>
          </div>
        )}
      {typeof terms.commercialConditions === "string" && (
        <p>{terms.commercialConditions}</p>
      )}
      {typeof terms.notes === "string" && <p>{terms.notes}</p>}
      <p>
        {t("partnerMarketplace.crews")}: {offer.crewCount}
      </p>
      <p>
        {t("partnerMarketplace.start")}:{" "}
        {offer.scheduledStartAt
          ? new Date(offer.scheduledStartAt).toLocaleString()
          : "—"}
      </p>
      <p>
        {t("partnerMarketplace.end")}:{" "}
        {offer.scheduledEndAt
          ? new Date(offer.scheduledEndAt).toLocaleString()
          : "—"}
      </p>
      <p>
        {t("partnerMarketplace.expires")}:{" "}
        {offer.expiresAt ? new Date(offer.expiresAt).toLocaleString() : "—"}
      </p>
      {offer.afeReference && (
        <p>
          {t("partnerMarketplace.afe")}: {offer.afeReference}
        </p>
      )}
      {offer.afeReference?.startsWith("PENDING-") && <p role="status">{t("partnerMarketplace.temporaryAfe")}</p>}
      {offer.poReference && (
        <p>
          {t("partnerMarketplace.po")}: {offer.poReference}
        </p>
      )}
      {offer.attachments
        ?.filter((url) => url.startsWith("https://"))
        .map((url, index) => (
          <a
            className="block underline"
            key={url}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("jobOffers.attachment", { number: index + 1 })}
          </a>
        ))}
    </div>
  );
}
