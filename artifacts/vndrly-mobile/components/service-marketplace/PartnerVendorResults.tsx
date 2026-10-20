import React, { useState } from "react";
import { Switch } from "react-native";
import { useTranslation } from "react-i18next";
import {
  useListSiteLocations,
  useSearchPartnerMarketplaceVendors,
  useGetPartnerMarketplaceVendor,
  MarketplaceSortParameter,
  type MarketplaceRankedVendor,
} from "@workspace/api-client-react";
import TogglePillButton from "@/components/TogglePillButton";
import { Field, Label, Panel } from "./primitives";
import { JobOfferComposer } from "./JobOfferSheet";

export default function PartnerVendorResults({
  partnerId,
  workTypeId,
}: {
  partnerId: number;
  workTypeId: number;
}) {
  const { t } = useTranslation();
  const sites = useListSiteLocations({ partnerId });
  const [siteId, setSiteId] = useState(0);
  const [capacity, setCapacity] = useState("1");
  const [sort, setSort] = useState<MarketplaceSortParameter>("recommended");
  const [eligibleOnly, setEligibleOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<MarketplaceRankedVendor | null>(
    null,
  );
  const params = {
    siteId,
    requestedCapacity: Number(capacity),
    sort,
    limit: 50,
    offset,
  };
  const search = useSearchPartnerMarketplaceVendors(
    partnerId,
    workTypeId,
    params,
    {
      query: {
        queryKey: ["mobile-marketplace-vendors", partnerId, workTypeId, params],
        enabled:
          siteId > 0 &&
          Number.isInteger(Number(capacity)) &&
          Number(capacity) > 0,
        retry: false,
      },
    },
  );
  const detail = useGetPartnerMarketplaceVendor(
    partnerId,
    workTypeId,
    selected?.vendorId ?? 0,
    {
      ...params,
      vendorCapabilityId: selected?.capabilityId ?? 0,
      vendorPartnerServiceOfferId: selected?.offer.id ?? 0,
    },
    {
      query: {
        queryKey: [
          "mobile-marketplace-vendor",
          partnerId,
          workTypeId,
          params,
          selected?.capabilityId,
          selected?.offer.id,
        ],
        enabled: !!selected && !search.isError,
        retry: false,
      },
    },
  );
  const reset = () => {
    setSelected(null);
    setOffset(0);
  };
  const latest = detail.data;
  const same =
    latest &&
    selected &&
    latest.vendorId === selected.vendorId &&
    latest.capabilityId === selected.capabilityId &&
    latest.offer.id === selected.offer.id;
  return (
    <Panel>
      <Label>{t("mobileMarketplace.selectSite")}</Label>
      {sites.data
        ?.filter((site) => site.isActive && site.partnerId === partnerId)
        .map((site) => (
          <TogglePillButton
            key={site.id}
            onPress={() => {
              setSiteId(site.id);
              reset();
            }}
          >
            {site.name}
          </TogglePillButton>
        ))}
      <Field
        label={t("mobileMarketplace.requestedCapacity")}
        value={capacity}
        keyboardType="number-pad"
        onChangeText={(value) => {
          setCapacity(value);
          reset();
        }}
      />
      <Label>{t("mobileMarketplace.sortLabel")}</Label>
      {Object.values(MarketplaceSortParameter).map((value) => (
        <TogglePillButton
          key={value}
          accessibilityState={{ selected: sort === value }}
          onPress={() => {
            setSort(value);
            reset();
          }}
        >
          {t(`mobileMarketplace.sort.${value}`)}
        </TogglePillButton>
      ))}
      <Label>{t("mobileMarketplace.eligibleOnly")}</Label>
      <Switch
        accessibilityLabel={t("mobileMarketplace.eligibleOnly")}
        value={eligibleOnly}
        onValueChange={setEligibleOnly}
      />
      <TogglePillButton
        disabled={search.isFetching || !siteId}
        onPress={() => {
          setSelected(null);
          void search.refetch();
        }}
      >
        {t("mobileMarketplace.refreshResults")}
      </TogglePillButton>
      {(sites.isError || search.isError || detail.isError) && (
        <Label alert>{t("mobileMarketplace.unavailable")}</Label>
      )}
      {!search.isError &&
        search.data?.items
          .filter((vendor) => !eligibleOnly || vendor.eligibility.eligible)
          .map((vendor) => (
            <Panel key={vendor.offer.id}>
              <Label>{vendor.vendorName}</Label>
              <Label>{vendor.capabilityName}</Label>
              <Label>{vendor.matchExplanation}</Label>
              <Label>
                {vendor.offer.currency} {vendor.offer.unitPrice} /{" "}
                {vendor.offer.unit}
              </Label>
              <Label>{t("mobileMarketplace.rating")}</Label>
              <Label>
                {vendor.ratingStatus === "not_yet_rated" ||
                vendor.rating === null
                  ? t("mobileMarketplace.notRated")
                  : `${vendor.rating} (${vendor.reviewCount})`}
              </Label>
              <Label>{t("mobileMarketplace.vndrlySafety")}</Label>
              <Label>
                {vendor.safetyStatus === "not_yet_rated" || !vendor.safety
                  ? t("mobileMarketplace.notRated")
                  : `${vendor.safety.score < 60 ? "🔴" : vendor.safety.score < 85 ? "🟠" : "🟢"} ${vendor.safety.score} / 100 · ${vendor.safety.source} · ${vendor.safety.refreshedAt}`}
              </Label>
              <Label>
                {t("mobileMarketplace.history", {
                  jobs: vendor.completedJobs,
                  prior: vendor.priorPartnerJobs,
                })}
              </Label>
              <Label>
                {t("mobileMarketplace.onTime")}:{" "}
                {vendor.onTimeRate === null
                  ? t("mobileMarketplace.notRated")
                  : `${Math.round(vendor.onTimeRate * 100)}%`}
              </Label>
              <Label>
                {t("mobileMarketplace.distance", {
                  distance: vendor.eligibility.facts.distanceMiles ?? "—",
                  radius: vendor.eligibility.facts.radiusMiles ?? "—",
                })}
              </Label>
              <Label>
                {t("mobileMarketplace.capacity")}:{" "}
                {vendor.eligibility.facts.availableCapacity}
              </Label>
              <Label>
                {t("mobileMarketplace.compliance")}:{" "}
                {vendor.complianceCurrent
                  ? t("mobileMarketplace.current")
                  : t("mobileMarketplace.needsReview")}
              </Label>
              <Label>
                {vendor.eligibility.eligible
                  ? t("mobileMarketplace.eligible")
                  : vendor.eligibility.reasonCodes
                      .map((reason) =>
                        t(`mobileMarketplace.reasons.${reason}`, {
                          defaultValue: reason,
                        }),
                      )
                      .join(", ")}
              </Label>
              <Label>{t("mobileMarketplace.advisoryHiring")}</Label>
              {vendor.eligibility.facts.missingCredentials.length > 0 && (
                <Label>
                  {vendor.eligibility.facts.missingCredentials.join(", ")}
                </Label>
              )}
              {vendor.factors.map((factor) => (
                <Label key={factor.name}>{factor.explanation}</Label>
              ))}
              <TogglePillButton
                accessibilityLabel={t("mobileMarketplace.offerTo", {
                  name: vendor.vendorName,
                })}
                disabled={
                  search.isFetching ||
                  !vendor.offerable ||
                  !vendor.eligibility.eligible
                }
                onPress={() => setSelected(vendor)}
              >
                {t("mobileMarketplace.offerJob")}
              </TogglePillButton>
            </Panel>
          ))}
      {!search.isError &&
        !detail.isError &&
        same &&
        latest.offerable &&
        latest.eligibility.eligible && (
          <JobOfferComposer
            key={`${siteId}:${latest.offer.id}:${capacity}`}
            partnerId={partnerId}
            workTypeId={workTypeId}
            siteId={siteId}
            vendor={latest}
            requestedCapacity={Number(capacity)}
            checking={search.isFetching || detail.isFetching}
          />
        )}
      <TogglePillButton
        disabled={!offset || search.isFetching}
        onPress={() => {
          setSelected(null);
          setOffset(Math.max(0, offset - 50));
        }}
      >
        {t("mobileMarketplace.previous")}
      </TogglePillButton>
      <TogglePillButton
        disabled={
          search.isFetching ||
          search.isError ||
          !search.data ||
          offset + 50 >= search.data.total
        }
        onPress={() => {
          setSelected(null);
          setOffset(offset + 50);
        }}
      >
        {t("mobileMarketplace.next")}
      </TogglePillButton>
    </Panel>
  );
}
