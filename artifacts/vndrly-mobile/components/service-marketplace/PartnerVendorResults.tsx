import React, { useRef, useState } from "react";
import { Switch } from "react-native";
import { useTranslation } from "react-i18next";
import {
  useListSiteLocations,
  requestPartnerMarketplaceQuote,
  useSearchPartnerMarketplaceVendors,
  useGetPartnerMarketplaceVendor,
  MarketplaceSortParameter,
  type MarketplaceRankedVendor,
} from "@workspace/api-client-react";
import TogglePillButton from "@/components/TogglePillButton";
import ImagePill from "@/components/ImagePill";
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
  const [quoteScope, setQuoteScope] = useState("");
  const [quoteState, setQuoteState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const quoteVersion = useRef(0);
  const quoteLocked = useRef(false);
  const clearQuote = () => { quoteVersion.current++; quoteLocked.current = false; setQuoteScope(""); setQuoteState("idle"); };
  const selectVendor = (vendor: MarketplaceRankedVendor) => { clearQuote(); setSelected(vendor); };
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
          Number(capacity) > 0 && Number(capacity) <= 100000,
        retry: false,
      },
    },
  );
  const detail = useGetPartnerMarketplaceVendor(
    partnerId,
    workTypeId,
    selected?.vendorId ?? 0,
    {
      siteId, requestedCapacity: Number(capacity), sort,
      vendorCapabilityId: selected?.capabilityId ?? 0,
      ...(selected?.offer ? { vendorPartnerServiceOfferId: selected.offer.id } : {}),
    },
    {
      query: {
        queryKey: [
          "mobile-marketplace-vendor",
          partnerId,
          workTypeId,
          params,
          selected?.capabilityId,
          selected?.offer?.id,
        ],
        enabled: !!selected && !search.isError,
        retry: false,
      },
    },
  );
  const reset = () => {
    setSelected(null);
    clearQuote();
    setOffset(0);
  };
  const latest = detail.data;
  const same =
    latest &&
    selected &&
    latest.vendorId === selected.vendorId &&
    latest.capabilityId === selected.capabilityId &&
    latest.offer?.id === selected.offer?.id;
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
          clearQuote();
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
            <Panel key={`${vendor.vendorId}:${vendor.capabilityId}:${vendor.offer?.id ?? "quote"}`}>
              <Label>{vendor.vendorName}</Label>
              <Label>{vendor.capabilityName}</Label>
              <Label>{vendor.matchExplanation}</Label>
              <Label>
                {vendor.offer ? `${vendor.offer.currency} ${vendor.offer.unitPrice} / ${vendor.offer.unit}` : t("mobileMarketplace.quoteRequired")}
              </Label>
              <Label>{t("mobileMarketplace.rating")}</Label>
              <Label>
                {vendor.ratingStatus === "not_yet_rated" ||
                vendor.rating === null
                  ? t("mobileMarketplace.notRated")
                  : `${vendor.rating} (${vendor.reviewCount})`}
              </Label>
              <Label>{t("mobileMarketplace.vndrlySafety")}</Label>
              {vendor.safetyStatus === "unavailable" ? <Label alert>{t("mobileMarketplace.complianceUnavailable")}</Label> : vendor.safetyStatus === "not_yet_rated" || !vendor.safety ? <Label>{t("mobileMarketplace.notRated")}</Label> : <>
                <ImagePill color={vendor.safety.score < 60 ? "red" : vendor.safety.score < 85 ? "amber" : "green"} accessibilityLabel={t("mobileMarketplace.scoreValue", { score: vendor.safety.score })}>{vendor.safety.score} / 100</ImagePill>
                <Label>{vendor.safety.source} · {new Date(vendor.safety.refreshedAt).toLocaleDateString()}</Label>
                {vendor.safety.reasons.map((reason) => <Label key={reason}>{t(`mobileMarketplace.scoreReasons.${reason}`)}</Label>)}
              </>}
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
              {!vendor.offer && <TogglePillButton
                accessibilityLabel={t("mobileMarketplace.quoteTo", { name: vendor.vendorName })}
                disabled={search.isFetching || !vendor.eligibility.eligible}
                onPress={() => selectVendor(vendor)}>
                {t("mobileMarketplace.requestQuote")}
              </TogglePillButton>}
              <TogglePillButton
                accessibilityLabel={t("mobileMarketplace.offerTo", {
                  name: vendor.vendorName,
                })}
                disabled={
                  search.isFetching ||
                  !vendor.offer ||
                  !vendor.offerable ||
                  !vendor.eligibility.eligible
                }
                onPress={() => selectVendor(vendor)}
              >
                {t("mobileMarketplace.offerJob")}
              </TogglePillButton>
            </Panel>
          ))}
      {selected && detail.data && !same && !detail.isFetching && <Label alert>{t("mobileMarketplace.changed")}</Label>}
      {!search.isError && !detail.isError && same && !latest.offer && latest.eligibility.eligible && <Panel>
        <Label>{t("mobileMarketplace.quoteExplanation")}</Label>
        <Field label={t("mobileMarketplace.quoteScope")} value={quoteScope} multiline maxLength={2000}
          editable={quoteState !== "sending" && quoteState !== "sent"} onChangeText={setQuoteScope} />
        <TogglePillButton disabled={search.isFetching || detail.isFetching || !quoteScope.trim() || quoteState === "sending" || quoteState === "sent"}
          onPress={async () => {
            if (quoteLocked.current || !quoteScope.trim() || search.isFetching || detail.isFetching) return;
            quoteLocked.current = true;
            const version = quoteVersion.current;
            setQuoteState("sending");
            try {
              await requestPartnerMarketplaceQuote(partnerId, workTypeId, latest.vendorId, {
                siteId, vendorCapabilityId: latest.capabilityId, requestedCapacity: Number(capacity), scope: quoteScope.trim(),
              });
              if (version === quoteVersion.current) setQuoteState("sent");
            } catch { if (version === quoteVersion.current) setQuoteState("error"); }
            finally { if (version === quoteVersion.current) quoteLocked.current = false; }
          }}>
          {t("mobileMarketplace.sendQuoteRequest")}
        </TogglePillButton>
        {quoteState === "sent" && <Label>{t("mobileMarketplace.quoteSent")}</Label>}
        {quoteState === "error" && <Label alert>{t("mobileMarketplace.quoteError")}</Label>}
      </Panel>}
      {!search.isError &&
        !detail.isError &&
        same &&
        latest.offer &&
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
