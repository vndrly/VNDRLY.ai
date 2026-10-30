import { CardHeading } from "@/components/ui/card-heading";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
  useListVendorMarketplaceJobOffers,
  getMarketplaceJobOffer,
  reviewMarketplaceJobOffer,
  acceptMarketplaceJobOffer,
  declineMarketplaceJobOffer,
  type MarketplaceJobOffer,
} from "@workspace/api-client-react";
import { PngPillButton } from "@/components/png-pill-rollover";
import JobOfferSummary from "./JobOfferSummary";

export default function VendorJobOfferInbox({
  vendorId,
}: {
  vendorId: number;
}) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const inbox = useListVendorMarketplaceJobOffers(vendorId);
  const [selected, setSelected] = useState<MarketplaceJobOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const operation = useRef<{
    offerId: number;
    version: number;
    key: string;
  } | null>(null);
  const locked = useRef(false);
  const isOpen = (offer: MarketplaceJobOffer) =>
    ["offered", "vendor_reviewing"].includes(offer.status) &&
    !!offer.expiresAt &&
    Date.parse(offer.expiresAt) > Date.now();
  const run = async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(false);
    try {
      await action();
    } catch {
      setSelected(null);
      setError(true);
      await inbox.refetch();
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const decide = (action: "accept" | "decline") =>
    run(async () => {
      if (!selected || !isOpen(selected)) throw new Error("Expired offer");
      if (action === "accept") {
        if (
          operation.current?.offerId !== selected.id ||
          operation.current.version !== selected.version
        )
          operation.current = {
            offerId: selected.id,
            version: selected.version,
            key: crypto.randomUUID(),
          };
        const result = await acceptMarketplaceJobOffer(
          selected.id,
          { version: selected.version },
          { headers: { "Idempotency-Key": operation.current.key } },
        );
        setSelected(null);
        void inbox.refetch();
        navigate(`/tickets/${result.ticketId}`);
      } else {
        await declineMarketplaceJobOffer(selected.id, {
          version: selected.version,
        });
        setSelected(null);
        await inbox.refetch();
      }
    });
  return (
    <section data-card-layout
      className="space-y-3 rounded border p-4"
      aria-label={t("jobOffers.inbox")}
    >
      <CardHeading as="h2" className="font-semibold">{t("jobOffers.inbox")}</CardHeading>
      {(error || inbox.isError) && <p role="alert">{t("jobOffers.changed")}</p>}
      <PngPillButton
        color="blue"
        type="button"
        disabled={busy || inbox.isFetching}
        onClick={() => {
          setSelected(null);
          void inbox.refetch();
        }}
      >
        {t("jobOffers.refresh")}
      </PngPillButton>
      {inbox.isLoading && <p role="status">{t("jobOffers.loading")}</p>}
      {inbox.data?.items.length === 0 && <p>{t("jobOffers.empty")}</p>}
      {inbox.data?.items.map((offer) => (
        <article key={offer.id} className="space-y-2 rounded border p-3">
          <p>
            {t("jobOffers.offerNumber", { number: offer.id })} ·{" "}
            {t(`jobOffers.status.${offer.status}`)}
          </p>
          <p>{offer.scope}</p>
          {isOpen(offer) && (
            <PngPillButton
              color="blue"
              disabled={busy || inbox.isFetching}
              type="button"
              onClick={() =>
                void run(async () => {
                  const current = await getMarketplaceJobOffer(offer.id);
                  if (!isOpen(current))
                    throw new Error("Offer is no longer open");
                  setSelected(
                    current.status === "offered"
                      ? await reviewMarketplaceJobOffer(current.id, {
                          version: current.version,
                        })
                      : current,
                  );
                })
              }
            >
              {t("jobOffers.review")}
            </PngPillButton>
          )}
          {offer.createdTicketId && (
            <a className="underline" href={`/tickets/${offer.createdTicketId}`}>
              {t("jobOffers.openTicket")}
            </a>
          )}
        </article>
      ))}
      {selected && (
        <section data-card-layout
          aria-label={t("jobOffers.confirmAccept")}
          className="space-y-3 rounded border p-3"
        >
          <CardHeading as="h3">{t("jobOffers.confirmAccept")}</CardHeading>
          <JobOfferSummary offer={selected} />
          <PngPillButton
            color="green"
            type="button"
            disabled={busy || inbox.isFetching || !isOpen(selected)}
            onClick={() => void decide("accept")}
          >
            {t("jobOffers.accept")}
          </PngPillButton>
          <PngPillButton
            color="red"
            type="button"
            disabled={busy || inbox.isFetching || !isOpen(selected)}
            onClick={() => void decide("decline")}
          >
            {t("jobOffers.decline")}
          </PngPillButton>
        </section>
      )}
    </section>
  );
}
