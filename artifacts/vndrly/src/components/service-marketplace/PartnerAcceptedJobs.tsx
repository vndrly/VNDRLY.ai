import { useTranslation } from "react-i18next";
import { useListPartnerMarketplaceJobOffers } from "@workspace/api-client-react";
import AcceptedJobTickets from "./AcceptedJobTickets";
import JobOfferSummary from "./JobOfferSummary";

export default function PartnerAcceptedJobs({ partnerId }: { partnerId: number }) {
  const { t } = useTranslation();
  const jobs = useListPartnerMarketplaceJobOffers(partnerId);
  const accepted = jobs.data?.items.filter((offer) => offer.status === "accepted") ?? [];
  return <section className="space-y-3" aria-label={t("jobOffers.acceptedJobs")}>
    <h2 className="font-semibold">{t("jobOffers.acceptedJobs")}</h2>
    {jobs.isLoading && <p role="status">{t("jobOffers.loading")}</p>}
    {jobs.isError && <p role="alert">{t("jobOffers.changed")}</p>}
    {!jobs.isLoading && !jobs.isError && accepted.length === 0 && <p>{t("jobOffers.noAcceptedJobs")}</p>}
    {accepted.map((offer) => <details key={offer.id} className="rounded border p-3">
      <summary className="cursor-pointer">#{offer.id} · {offer.scope} · {offer.afeReference}</summary>
      <JobOfferSummary offer={offer} />
      <AcceptedJobTickets offer={offer} />
    </details>)}
  </section>;
}
