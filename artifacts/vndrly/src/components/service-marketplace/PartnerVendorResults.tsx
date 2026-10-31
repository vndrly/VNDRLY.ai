import { CardHeading } from "@/components/ui/card-heading";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useListSiteLocations,
  requestPartnerMarketplaceQuote,
  useSearchPartnerMarketplaceVendors,
  useGetPartnerMarketplaceVendor,
  getSearchPartnerMarketplaceVendorsQueryKey,
  getGetPartnerMarketplaceVendorQueryKey,
  type MarketplaceRankedVendor,
  type MarketplaceSortParameter,
} from "@workspace/api-client-react";
import { PngPillButton as TogglePillButton } from "@/components/png-pill-rollover";
import VendorComparisonCard from "./VendorComparisonCard";
import JobOfferComposer from "./JobOfferComposer";

export default function PartnerVendorResults({
  partnerId,
  workTypeId,
}: {
  partnerId: number;
  workTypeId: number;
}) {
  const { t } = useTranslation();
  const id = useId();
  const sites = useListSiteLocations({ partnerId });
  const [siteId, setSiteId] = useState(0);
  const [capacity, setCapacity] = useState("1");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [sort, setSort] = useState<MarketplaceSortParameter>("recommended");
  const [eligibleOnly, setEligibleOnly] = useState(false);
  const [compared, setCompared] = useState<string[]>([]);
  const [detailSelection, setDetailSelection] =
    useState<MarketplaceRankedVendor | null>(null);
  const detailId = detailSelection?.vendorId ?? 0;
  const [offerVendor, setOfferVendor] =
    useState<MarketplaceRankedVendor | null>(null);
  const [offset, setOffset] = useState(0);
  const [quoteScope, setQuoteScope] = useState("");
  const [quoteState, setQuoteState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const rowKey = (vendor: MarketplaceRankedVendor) => `${vendor.vendorId}:${vendor.capabilityId}:${vendor.offer?.id ?? "quote"}`;
  const site = sites.data?.find(
    (item) =>
      item.id === siteId && item.partnerId === partnerId && item.isActive,
  );
  const validCoordinates =
    !!site &&
    site.latitude !== null &&
    site.longitude !== null &&
    Number.isFinite(site.latitude) &&
    Number.isFinite(site.longitude) &&
    Math.abs(site.latitude) <= 90 &&
    Math.abs(site.longitude) <= 180;
  const requestedCapacity = Number(capacity);
  const validCapacity =
    Number.isInteger(requestedCapacity) &&
    requestedCapacity >= 1 &&
    requestedCapacity <= 100000;
  const params = { siteId, requestedCapacity, sort, limit: 50, offset };
  const detailParams = {
    siteId,
    requestedCapacity,
    sort,
    vendorCapabilityId: detailSelection?.capabilityId ?? 0,
    ...(detailSelection?.offer ? { vendorPartnerServiceOfferId: detailSelection.offer.id } : {}),
  };
  const enabled = validCoordinates && validCapacity;
  const search = useSearchPartnerMarketplaceVendors(
    partnerId,
    workTypeId,
    params,
    {
      query: {
        queryKey: getSearchPartnerMarketplaceVendorsQueryKey(
          partnerId,
          workTypeId,
          params,
        ),
        enabled,
        retry: false,
      },
    },
  );
  const details = useGetPartnerMarketplaceVendor(
    partnerId,
    workTypeId,
    detailId,
    detailParams,
    {
      query: {
        queryKey: getGetPartnerMarketplaceVendorQueryKey(
          partnerId,
          workTypeId,
          detailId,
          detailParams,
        ),
        enabled: enabled && detailId > 0,
        retry: false,
      },
    },
  );
  const clearSelection = () => {
    setCompared([]);
    setOfferVendor(null);
    setDetailSelection(null);
    setOffset(0);
    setQuoteState("idle");
    setQuoteScope("");
  };
  const vendors = enabled && !search.isError ? (search.data?.items ?? []) : [];
  const visible = vendors.filter(
    (vendor) => !eligibleOnly || vendor.eligibility.eligible,
  );
  const selected = vendors.filter((vendor) =>
    compared.includes(rowKey(vendor)),
  );
  const sameOffer =
    !!offerVendor &&
    !!details.data &&
    details.data.vendorId === offerVendor.vendorId &&
    details.data.capabilityId === offerVendor.capabilityId &&
    details.data.offer?.id === offerVendor.offer?.id;
  return (
    <div
      className="p-4 space-y-4 border-t"
      data-testid={`marketplace-work-type-${workTypeId}`}
    >
      <h3 className="font-semibold">{t("partnerMarketplace.title")}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-sm" htmlFor={`${id}-site`}>
          {t("partnerMarketplace.site")}
          <select
            id={`${id}-site`}
            aria-label={t("partnerMarketplace.site")}
            className="rounded border bg-background p-2"
            value={siteId}
            onChange={(event) => {
              setSiteId(Number(event.target.value));
              clearSelection();
            }}
          >
            <option value={0}>{t("partnerMarketplace.chooseSite")}</option>
            {(sites.data ?? [])
              .filter((item) => item.partnerId === partnerId && item.isActive)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm" htmlFor={`${id}-capacity`}>
          {t("partnerMarketplace.crews")}
          <input
            id={`${id}-capacity`}
            type="number"
            min={1}
            max={100000}
            className="rounded border bg-background p-2"
            value={capacity}
            onChange={(event) => {
              setCapacity(event.target.value);
              clearSelection();
            }}
          />
        </label>
        <label className="grid gap-1 text-sm" htmlFor={`${id}-start`}>
          {t("partnerMarketplace.start")}
          <input
            id={`${id}-start`}
            type="datetime-local"
            className="rounded border bg-background p-2"
            value={start}
            onChange={(event) => {
              setStart(event.target.value);
              clearSelection();
            }}
          />
        </label>
        <label className="grid gap-1 text-sm" htmlFor={`${id}-end`}>
          {t("partnerMarketplace.end")}
          <input
            id={`${id}-end`}
            type="datetime-local"
            className="rounded border bg-background p-2"
            value={end}
            onChange={(event) => {
              setEnd(event.target.value);
              clearSelection();
            }}
          />
        </label>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("partnerMarketplace.scheduleHelp")}
      </p>
      {sites.isLoading && (
        <p role="status">{t("partnerMarketplace.loadingSites")}</p>
      )}
      {sites.isError && (
        <div role="alert">
          {t("partnerMarketplace.sitesError")}{" "}
          <TogglePillButton color="blue" onClick={() => void sites.refetch()}>
            {t("partnerMarketplace.retrySites")}
          </TogglePillButton>
        </div>
      )}
      {!siteId && <p>{t("partnerMarketplace.siteRequired")}</p>}
      {siteId > 0 && !validCoordinates && !sites.isLoading && (
        <p role="alert">
          {t("partnerMarketplace.coordinatesRequired")}{" "}
          <a className="underline" href={`/site-locations/${siteId}`}>
            {t("partnerMarketplace.manageCoordinates")}
          </a>
        </p>
      )}
      {!validCapacity && (
        <p role="alert">{t("partnerMarketplace.invalidCapacity")}</p>
      )}
      {enabled && (
        <>
          <div className="flex flex-wrap gap-4 items-center">
            <label htmlFor={`${id}-sort`}>
              {t("partnerMarketplace.sortLabel")}{" "}
              <select
                id={`${id}-sort`}
                className="rounded border bg-background p-2"
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as MarketplaceSortParameter);
                  clearSelection();
                }}
              >
                {(
                  [
                    "recommended",
                    "price",
                    "rating",
                    "safety",
                    "history",
                    "onTime",
                    "distance",
                    "availability",
                    "priorExperience",
                  ] as const
                ).map((value) => (
                  <option key={value} value={value}>
                    {t(`partnerMarketplace.sort.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor={`${id}-eligible`}>
              <input
                id={`${id}-eligible`}
                type="checkbox"
                checked={eligibleOnly}
                onChange={(event) => setEligibleOnly(event.target.checked)}
              />{" "}
              {t("partnerMarketplace.eligibleOnly")}
            </label>
          </div>
          {search.isFetching && (
            <p role="status">{t("partnerMarketplace.loading")}</p>
          )}
          {search.isError && (
            <div role="alert">
              {t("partnerMarketplace.searchError")}{" "}
              <TogglePillButton
                color="blue"
                onClick={() => void search.refetch()}
              >
                {t("partnerMarketplace.retry")}
              </TogglePillButton>
            </div>
          )}
          {!search.isFetching && !search.isError && visible.length === 0 && (
            <p>{t("partnerMarketplace.empty")}</p>
          )}
          <div className="grid gap-4 xl:grid-cols-2">
            {visible.map((vendor) => (
              <VendorComparisonCard
                key={rowKey(vendor)}
                vendor={vendor}
                compared={compared.includes(rowKey(vendor))}
                onCompare={() =>
                  setCompared(
                    compared.includes(rowKey(vendor))
                      ? compared.filter((value) => value !== rowKey(vendor))
                      : [...compared, rowKey(vendor)],
                  )
                }
                onDetails={() => {
                  setDetailSelection(vendor);
                  setOfferVendor(null);
                  setQuoteScope("");
                  setQuoteState("idle");
                }}
                onQuote={() => {
                  setDetailSelection(vendor);
                  setOfferVendor(null);
                  setQuoteScope("");
                  setQuoteState("idle");
                }}
                onOffer={() => {
                  setDetailSelection(vendor);
                  setOfferVendor(vendor);
                }}
              />
            ))}
          </div>
          {selected.length >= 2 && (
            <section
              aria-label={t("partnerMarketplace.comparison")}
              className="overflow-x-auto"
            >
              <h4 className="font-semibold">
                {t("partnerMarketplace.comparison")}
              </h4>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th scope="col">{t("partnerMarketplace.vendor")}</th>
                    <th scope="col">{t("partnerMarketplace.price")}</th>
                    <th scope="col">{t("partnerMarketplace.rating")}</th>
                    <th scope="col">{t("partnerMarketplace.eligible")}</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.map((vendor) => (
                    <tr key={rowKey(vendor)}>
                      <th scope="row">{vendor.vendorName}</th>
                      <td>
                        {vendor.offer ? `${vendor.offer.currency} ${vendor.offer.unitPrice.toFixed(2)} / ${vendor.offer.unit}` : t("partnerMarketplace.quoteRequired")}
                      </td>
                      <td>
                        {vendor.rating ?? t("partnerMarketplace.notYetRated")}
                      </td>
                      <td>
                        {t(
                          vendor.eligibility.eligible
                            ? "partnerMarketplace.eligible"
                            : "partnerMarketplace.ineligible",
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {detailId > 0 && (
            <section data-card-layout
              aria-label={t("partnerMarketplace.details")}
              className="rounded border p-3"
            >
              {details.isFetching && (
                <p role="status">{t("partnerMarketplace.loading")}</p>
              )}
              {details.isError && (
                <p role="alert">{t("partnerMarketplace.searchError")}</p>
              )}
              {details.data && !details.isError && !details.isFetching && (
                <>
                  <CardHeading as="h4">{details.data.vendorName}</CardHeading>
                  <p>{details.data.matchExplanation}</p>
                  <p>{details.data.offer?.commercialConditions ?? t("partnerMarketplace.quoteRequired")}</p>
                  {!details.data.offer && details.data.eligibility.eligible && (
                    <form className="space-y-2" onSubmit={async (event) => {
                      event.preventDefault();
                      if (!detailSelection || quoteState === "sending" || !quoteScope.trim()) return;
                      setQuoteState("sending");
                      try {
                        await requestPartnerMarketplaceQuote(partnerId, workTypeId, detailSelection.vendorId, {
                          siteId, vendorCapabilityId: detailSelection.capabilityId, requestedCapacity, scope: quoteScope.trim(),
                        });
                        setQuoteState("sent");
                      } catch { setQuoteState("error"); }
                    }}>
                      <p className="text-sm">{t("partnerMarketplace.quoteExplanation")}</p>
                      <label className="grid gap-1" htmlFor={`${id}-quote-scope`}>
                        {t("partnerMarketplace.quoteScope")}
                        <textarea id={`${id}-quote-scope`} className="rounded border bg-background p-2" required maxLength={2000}
                          value={quoteScope} onChange={(event) => setQuoteScope(event.target.value)} disabled={quoteState === "sending" || quoteState === "sent"} />
                      </label>
                      <TogglePillButton type="submit" color="blue" disabled={!quoteScope.trim() || quoteState === "sending" || quoteState === "sent"}>
                        {t("partnerMarketplace.requestQuote")}
                      </TogglePillButton>
                      {quoteState === "sent" && <p role="status">{t("partnerMarketplace.quoteSent")}</p>}
                      {quoteState === "error" && <p role="alert">{t("partnerMarketplace.quoteError")}</p>}
                    </form>
                  )}
                </>
              )}
            </section>
          )}
          {offerVendor &&
            details.data &&
            !sameOffer &&
            !details.isFetching &&
            !details.isError && (
              <div role="alert">
                {t("partnerMarketplace.offerChanged")}{" "}
                <TogglePillButton
                  color="blue"
                  onClick={() => {
                    clearSelection();
                    void search.refetch();
                  }}
                >
                  {t("partnerMarketplace.retry")}
                </TogglePillButton>
              </div>
            )}
          {offerVendor && sameOffer && details.data && (
            <JobOfferComposer
              key={`${siteId}-${requestedCapacity}-${start}-${end}-${offerVendor.offer?.id}`}
              partnerId={partnerId}
              workTypeId={workTypeId}
              siteLocationId={siteId}
              vendor={details.data}
              initialStartAt={start}
              initialEndAt={end}
              crewCount={requestedCapacity}
              isChecking={details.isFetching || details.isError}
            />
          )}
          <div className="flex gap-3">
            <TogglePillButton
              color="blue"
              disabled={offset === 0 || search.isFetching}
              onClick={() => {
                setOffset(Math.max(0, offset - 50));
                setCompared([]);
                setOfferVendor(null);
                setDetailSelection(null);
              }}
            >
              {t("partnerMarketplace.previous")}
            </TogglePillButton>
            <TogglePillButton
              color="blue"
              disabled={
                search.isFetching ||
                !search.data ||
                offset + search.data.items.length >= search.data.total
              }
              onClick={() => {
                setOffset(offset + 50);
                setCompared([]);
                setOfferVendor(null);
                setDetailSelection(null);
              }}
            >
              {t("partnerMarketplace.next")}
            </TogglePillButton>
          </div>
        </>
      )}
    </div>
  );
}
