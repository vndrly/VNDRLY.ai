import React, { useEffect, useRef, useState } from "react";
import { Linking } from "react-native";
import { router } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useTranslation } from "react-i18next";
import {
  useListVendorMarketplaceJobOffers,
  createMarketplaceJobOffer,
  sendMarketplaceJobOffer,
  getMarketplaceJobOffer,
  reviewMarketplaceJobOffer,
  acceptMarketplaceJobOffer,
  declineMarketplaceJobOffer,
  withdrawMarketplaceJobOffer,
  type MarketplaceJobOffer,
  type MarketplaceJobOfferDraft,
  type MarketplaceRankedVendor,
} from "@workspace/api-client-react";
import TogglePillButton from "@/components/TogglePillButton";
import { getApiErrorCode } from "@/lib/apiErrors";
import { Field, Label, Panel } from "./primitives";

function Summary({ offer }: { offer: MarketplaceJobOffer }) {
  const { t } = useTranslation();
  const terms = offer.commercialSnapshot;
  const scalar = (value: unknown) =>
    typeof value === "string" || typeof value === "number"
      ? String(value)
      : "—";
  return (
    <Panel>
      <Label>
        {t("mobileMarketplace.offerIdentity", {
          offer: offer.id,
          partner: offer.partnerId,
          site: offer.siteLocationId,
          service: offer.workTypeId,
        })}
      </Label>
      <Label>{offer.scope}</Label>
      <Label>
        {scalar(terms.currency)} {scalar(terms.unitPrice)} /{" "}
        {scalar(terms.unit)}
      </Label>
      {terms.automaticBilling === "manual_billing_required" && (
        <Label>{t("mobileMarketplace.manualBilling")}</Label>
      )}
      {terms.automaticBilling === "hourly_usd" &&
        terms.billingRules != null &&
        typeof terms.billingRules === "object" && (
          <Label>
            {t("mobileMarketplace.billingRules")}:{" "}
            {JSON.stringify(terms.billingRules)}
          </Label>
        )}
      {terms.rateComponents != null &&
        typeof terms.rateComponents === "object" && (
          <Label>
            {t("mobileMarketplace.rateComponents")}:{" "}
            {JSON.stringify(terms.rateComponents)}
          </Label>
        )}
      {typeof terms.commercialConditions === "string" && (
        <Label>{terms.commercialConditions}</Label>
      )}
      {typeof terms.notes === "string" && <Label>{terms.notes}</Label>}
      <Label>
        {t("mobileMarketplace.capacity")}: {offer.crewCount}
      </Label>
      <Label>
        {t("mobileMarketplace.start")}: {offer.scheduledStartAt ?? "—"}
      </Label>
      <Label>
        {t("mobileMarketplace.end")}: {offer.scheduledEndAt ?? "—"}
      </Label>
      <Label>
        {t("mobileMarketplace.expires")}: {offer.expiresAt ?? "—"}
      </Label>
      {offer.afeReference && (
        <Label>
          {t("mobileMarketplace.afe")}: {offer.afeReference}
        </Label>
      )}
      {offer.poReference && (
        <Label>
          {t("mobileMarketplace.po")}: {offer.poReference}
        </Label>
      )}
      {offer.attachments
        ?.filter((url) => url.startsWith("https://"))
        .map((url, index) => (
          <TogglePillButton key={url} onPress={() => void Linking.openURL(url)}>
            {t("mobileMarketplace.attachment", { number: index + 1 })}
          </TogglePillButton>
        ))}
    </Panel>
  );
}

export function JobOfferComposer({
  partnerId,
  workTypeId,
  siteId,
  vendor,
  requestedCapacity,
  checking = false,
}: {
  partnerId: number;
  workTypeId: number;
  siteId: number;
  vendor: MarketplaceRankedVendor;
  requestedCapacity: number;
  checking?: boolean;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    scope: "",
    start: "",
    end: "",
    expires: "",
    crews: String(requestedCapacity),
    afe: "",
    po: "",
    attachments: "",
  });
  const [saved, setSaved] = useState<MarketplaceJobOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const locked = useRef(false);
  const operation = useRef<{ fingerprint: string; key: string } | null>(null);
  const sent =
    !!saved && ["offered", "vendor_reviewing"].includes(saved.status);
  const run = async (work: () => Promise<void>) => {
    if (locked.current || checking) return;
    locked.current = true;
    setBusy(true);
    setError(false);
    try {
      await work();
    } catch {
      setError(true);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const field = (key: keyof typeof form, label: string) => (
    <Field
      label={label}
      value={form[key]}
      multiline={key === "scope" || key === "attachments"}
      keyboardType={key === "crews" ? "number-pad" : "default"}
      editable={!busy && !sent}
      maxLength={key === "afe" ? 200 : undefined}
      onChangeText={(value) => {
        setForm((current) => ({ ...current, [key]: value }));
        setSaved(null);
      }}
    />
  );
  const prepare = () =>
    run(async () => {
      const start = Date.parse(form.start),
        end = Date.parse(form.end),
        expires = Date.parse(form.expires);
      const crews = Number(form.crews);
      const attachments = form.attachments
        .split(/\r?\n/)
        .map((url) => url.trim())
        .filter(Boolean);
      if (
        !vendor.offer ||
        !vendor.offerable ||
        !form.afe.trim() ||
        form.afe.trim().length > 200 ||
        !vendor.eligibility.eligible ||
        !form.scope.trim() ||
        form.scope.trim().length > 10000 ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= start ||
        !Number.isFinite(expires) ||
        expires <= Date.now() ||
        expires > start ||
        !Number.isInteger(crews) ||
        crews < 1 ||
        crews > 100000 ||
        crews > vendor.eligibility.facts.availableCapacity ||
        attachments.length > 20 ||
        attachments.some((url) => {
          try {
            return new URL(url).protocol !== "https:";
          } catch {
            return true;
          }
        })
      )
        throw new Error("Invalid offer");
      const data: MarketplaceJobOfferDraft = {
        partnerId,
        workTypeId,
        vendorId: vendor.vendorId,
        vendorCapabilityId: vendor.capabilityId,
        vendorPartnerServiceOfferId: vendor.offer.id,
        siteLocationId: siteId,
        scope: form.scope.trim(),
        requestedStartAt: new Date(start).toISOString(),
        requestedEndAt: new Date(end).toISOString(),
        crewCount: crews,
        attachmentUrls: attachments,
        expiresAt: new Date(expires).toISOString(),
        afeCode: form.afe.trim(),
        ...(form.po.trim() ? { poNumber: form.po.trim() } : {}),
      };
      const fingerprint = JSON.stringify(data);
      if (operation.current?.fingerprint !== fingerprint)
        operation.current = { fingerprint, key: randomUUID() };
      setSaved(
        await createMarketplaceJobOffer(data, {
          headers: { "Idempotency-Key": operation.current.key },
        }),
      );
    });
  const send = () =>
    run(async () => {
      if (!saved) return;
      try {
        setSaved(
          await sendMarketplaceJobOffer(saved.id, { version: saved.version }),
        );
      } catch {
        // Reconcile a committed send after a lost response. Any unsent/changed draft needs a fresh review.
        const latest = await getMarketplaceJobOffer(saved.id).catch(() => null);
        if (
          latest &&
          ["offered", "vendor_reviewing", "accepted"].includes(latest.status)
        )
          setSaved(latest);
        else {
          setSaved(null);
          operation.current = null;
          throw new Error("Offer changed");
        }
      }
    });
  return (
    <Panel>
      <Label>{vendor.vendorName}</Label>
      {field("scope", t("mobileMarketplace.scope"))}
      {field("start", t("mobileMarketplace.start"))}
      {field("end", t("mobileMarketplace.end"))}
      {field("expires", t("mobileMarketplace.expires"))}
      {field("crews", t("mobileMarketplace.capacity"))}
      <Label>{t("mobileMarketplace.afeRequired")}</Label>
      {field("afe", t("mobileMarketplace.afe"))}
      {field("po", t("mobileMarketplace.po"))}
      {field("attachments", t("mobileMarketplace.attachments"))}
      <TogglePillButton
        disabled={
          busy ||
          checking ||
          sent ||
          !vendor.offer ||
          !vendor.offerable ||
          !vendor.eligibility.eligible
        }
        onPress={() => void prepare()}
      >
        {t("mobileMarketplace.prepare")}
      </TogglePillButton>
      {saved?.status === "draft" && (
        <>
          <Label>{t("mobileMarketplace.confirmSend")}</Label>
          <Summary offer={saved} />
          <TogglePillButton
            disabled={busy || checking}
            onPress={() => void send()}
          >
            {t("mobileMarketplace.send")}
          </TogglePillButton>
        </>
      )}
      {sent && <Label>{t("mobileMarketplace.sent")}</Label>}
      {saved &&
        ["draft", "offered", "vendor_reviewing"].includes(saved.status) && (
          <TogglePillButton
            color="red"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                try {
                  setSaved(
                    await withdrawMarketplaceJobOffer(saved.id, {
                      version: saved.version,
                    }),
                  );
                } catch {
                  setSaved(null);
                  throw new Error("Offer changed");
                }
              })
            }
          >
            {t("mobileMarketplace.withdraw")}
          </TogglePillButton>
        )}
      {saved?.status === "withdrawn" && (
        <Label>{t("mobileMarketplace.status.withdrawn")}</Label>
      )}
      {error && <Label alert>{t("mobileMarketplace.changed")}</Label>}
    </Panel>
  );
}

export default function JobOfferSheet({ vendorId }: { vendorId: number }) {
  const { t } = useTranslation();
  const inbox = useListVendorMarketplaceJobOffers(vendorId);
  const [selected, setSelected] = useState<MarketplaceJobOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const locked = useRef(false);
  const operation = useRef<{
    offerId: number;
    version: number;
    key: string;
  } | null>(null);
  const open = (offer: MarketplaceJobOffer) =>
    ["offered", "vendor_reviewing"].includes(offer.status);
  const run = async (work: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(false);
    setErrorCode(null);
    try {
      await work();
    } catch (error) {
      setSelected(null);
      setError(true);
      setErrorCode(
        getApiErrorCode(error)?.replace(/^marketplace\./, "") ?? null,
      );
      await inbox.refetch();
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const accept = () =>
    run(async () => {
      if (!selected) return;
      if (
        operation.current?.offerId !== selected.id ||
        operation.current.version !== selected.version
      )
        operation.current = {
          offerId: selected.id,
          version: selected.version,
          key: randomUUID(),
        };
      let ticketId: number;
      try {
        ticketId = (
          await acceptMarketplaceJobOffer(
            selected.id,
            { version: selected.version },
            { headers: { "Idempotency-Key": operation.current.key } },
          )
        ).ticketId;
      } catch (error) {
        const latest = await getMarketplaceJobOffer(selected.id).catch(
          () => null,
        );
        if (latest?.status !== "accepted" || !latest.createdTicketId)
          throw error;
        ticketId = latest.createdTicketId;
      }
      if (!mounted.current) return;
      setSelected(null);
      void inbox.refetch();
      router.push(`/ticket/${ticketId}`);
    });
  return (
    <Panel>
      <Label>{t("mobileMarketplace.inbox")}</Label>
      <TogglePillButton
        disabled={busy || inbox.isFetching}
        onPress={() => {
          setSelected(null);
          void inbox.refetch();
        }}
      >
        {t("mobileMarketplace.refresh")}
      </TogglePillButton>
      {(error || inbox.isError) && (
        <Label alert>
          {t(
            inbox.isError
              ? "mobileMarketplace.unavailable"
              : "mobileMarketplace.changed",
          )}
        </Label>
      )}
      {error && errorCode && (
        <Label>
          {t(`mobileMarketplace.offerErrors.${errorCode}`, {
            defaultValue: t(
              `mobileMarketplace.reasons.${errorCode.toUpperCase()}`,
              { defaultValue: t("mobileMarketplace.changed") },
            ),
          })}
        </Label>
      )}
      {!inbox.isError && inbox.data?.items.length === 0 && (
        <Label>{t("mobileMarketplace.emptyOffers")}</Label>
      )}
      {!inbox.isError &&
        inbox.data?.items.map((offer) => (
          <Panel key={offer.id}>
            <Label>{offer.scope}</Label>
            <Label>{t(`mobileMarketplace.status.${offer.status}`)}</Label>
            {open(offer) && (
              <TogglePillButton
                disabled={busy || inbox.isFetching}
                accessibilityLabel={t("mobileMarketplace.reviewNumber", {
                  number: offer.id,
                })}
                onPress={() =>
                  void run(async () => {
                    const latest = await getMarketplaceJobOffer(offer.id);
                    if (!open(latest)) throw new Error("Offer changed");
                    setSelected(
                      latest.status === "offered"
                        ? await reviewMarketplaceJobOffer(latest.id, {
                            version: latest.version,
                          })
                        : latest,
                    );
                  })
                }
              >
                {t("mobileMarketplace.review")}
              </TogglePillButton>
            )}
            {!!offer.createdTicketId && (
              <TogglePillButton
                onPress={() => router.push(`/ticket/${offer.createdTicketId}`)}
              >
                {t("mobileMarketplace.openTicket")}
              </TogglePillButton>
            )}
          </Panel>
        ))}
      {selected && !inbox.isError && (
        <Panel>
          <Label>{t("mobileMarketplace.confirmAccept")}</Label>
          <Summary offer={selected} />
          <TogglePillButton
            color="green"
            disabled={busy || inbox.isFetching}
            onPress={() => void accept()}
          >
            {t("mobileMarketplace.accept")}
          </TogglePillButton>
          <TogglePillButton
            color="red"
            disabled={busy || inbox.isFetching}
            onPress={() =>
              void run(async () => {
                await declineMarketplaceJobOffer(selected.id, {
                  version: selected.version,
                });
                setSelected(null);
                await inbox.refetch();
              })
            }
          >
            {t("mobileMarketplace.decline")}
          </TogglePillButton>
        </Panel>
      )}
    </Panel>
  );
}
