import { CardHeading } from "@/components/ui/card-heading";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MarketplaceRankedVendor } from "@workspace/api-client-react";
import {
  createMarketplaceJobOffer,
  sendMarketplaceJobOffer,
  getMarketplaceJobOffer,
  withdrawMarketplaceJobOffer,
  type MarketplaceJobOffer,
} from "@workspace/api-client-react";
import JobOfferSummary from "./JobOfferSummary";
import { PngPillButton as TogglePillButton } from "@/components/png-pill-rollover";

/** Draft handoff to the offer API. Prices and eligibility are derived by the server. */
export interface CreateJobOfferInput {
  partnerId: number;
  workTypeId: number;
  vendorId: number;
  vendorCapabilityId: number;
  vendorPartnerServiceOfferId: number;
  siteLocationId: number;
  scope: string;
  requestedStartAt: string;
  requestedEndAt: string;
  crewCount: number;
  afeCode: string;
  poNumber?: string;
  attachmentUrls: string[];
  expiresAt: string;
}

export default function JobOfferComposer({
  partnerId,
  workTypeId,
  siteLocationId,
  vendor,
  initialStartAt = "",
  initialEndAt = "",
  crewCount = 1,
  onPrepared,
  isChecking = false,
}: {
  partnerId: number;
  workTypeId: number;
  siteLocationId: number;
  vendor: MarketplaceRankedVendor;
  initialStartAt?: string;
  initialEndAt?: string;
  crewCount?: number;
  onPrepared?: (draft: CreateJobOfferInput) => void;
  isChecking?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [form, setForm] = useState({
    scope: "",
    start: initialStartAt,
    end: initialEndAt,
    crews: String(crewCount),
    afe: "",
    po: "",
    attachments: "",
    expires: "",
  });
  const [error, setError] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [saved, setSaved] = useState<MarketplaceJobOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState(false);
  const createOperation = useRef<{ fingerprint: string; key: string } | null>(
    null,
  );
  const busyRef = useRef(false);
  const sent =
    saved?.status === "offered" || saved?.status === "vendor_reviewing";
  const prepare = async (draft: CreateJobOfferInput) => {
    if (onPrepared) {
      onPrepared(draft);
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setApiError(false);
    const fingerprint = JSON.stringify(draft);
    if (createOperation.current?.fingerprint !== fingerprint)
      createOperation.current = { fingerprint, key: crypto.randomUUID() };
    try {
      setSaved(
        await createMarketplaceJobOffer(draft, {
          headers: { "Idempotency-Key": createOperation.current.key },
        }),
      );
    } catch {
      setApiError(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const send = async () => {
    if (!saved || busyRef.current || isChecking) return;
    busyRef.current = true;
    setBusy(true);
    setApiError(false);
    try {
      setSaved(
        await sendMarketplaceJobOffer(saved.id, { version: saved.version }),
      );
    } catch {
      // A lost response may have followed a committed send; read the canonical result.
      try {
        const latest = await getMarketplaceJobOffer(saved.id);
        if (["offered", "vendor_reviewing"].includes(latest.status))
          setSaved(latest);
        else {
          setSaved(null);
          setApiError(true);
          createOperation.current = null;
        }
      } catch {
        setSaved(null);
        setApiError(true);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const field = (key: keyof typeof form, label: string, type = "text") => (
    <label className="grid gap-1 text-sm" htmlFor={`${id}-${key}`}>
      {t(`partnerMarketplace.${label}`)}
      <input
        id={`${id}-${key}`}
        type={type}
        className="rounded border bg-background p-2"
        value={form[key]}
        required={key === "afe"}
        maxLength={key === "afe" ? 200 : undefined}
        disabled={busy || sent}
        onChange={(e) => {
          setForm({ ...form, [key]: e.target.value });
          setPrepared(false);
          setSaved(null);
        }}
      />
    </label>
  );
  return (
    <form
      className="space-y-3 rounded border p-4"
      aria-label={t("partnerMarketplace.composer")}
      onSubmit={(event) => {
        event.preventDefault();
        const start = Date.parse(form.start),
          end = Date.parse(form.end),
          expires = Date.parse(form.expires);
        const crews = Number(form.crews);
        const attachments = form.attachments
          .split(/\r?\n/)
          .map((url) => url.trim())
          .filter(Boolean);
        const validUrls = attachments.every((raw) => {
          try {
            return new URL(raw).protocol === "https:";
          } catch {
            return false;
          }
        });
        if (
          isChecking ||
          !vendor.offer ||
          !vendor.offerable ||
          !vendor.eligibility.eligible ||
          !form.scope.trim() ||
          !form.afe.trim() ||
          form.afe.trim().length > 200 ||
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
          !validUrls ||
          attachments.length > 20
        ) {
          setError(true);
          setPrepared(false);
          return;
        }
        const draft: CreateJobOfferInput = {
          partnerId,
          workTypeId,
          vendorId: vendor.vendorId,
          vendorCapabilityId: vendor.capabilityId,
          vendorPartnerServiceOfferId: vendor.offer.id,
          siteLocationId,
          scope: form.scope.trim(),
          requestedStartAt: new Date(start).toISOString(),
          requestedEndAt: new Date(end).toISOString(),
          crewCount: crews,
          attachmentUrls: attachments,
          expiresAt: new Date(expires).toISOString(),
          afeCode: form.afe.trim(),
          ...(form.po.trim() ? { poNumber: form.po.trim() } : {}),
        };
        setError(false);
        setPrepared(true);
        void prepare(draft);
      }}
    >
      <h4 className="font-semibold">
        {t("partnerMarketplace.composer")} · {vendor.vendorName}
      </h4>
      {vendor.offer && <p className="text-sm">
        {t("partnerMarketplace.rateBasis")}: {vendor.offer.currency}{" "}
        {vendor.offer.unitPrice.toFixed(2)} / {vendor.offer.unit}
      </p>}
      <p className="text-sm text-muted-foreground">
        {t("partnerMarketplace.savedTerms")}
      </p>
      {field("scope", "scope")}
      <div className="grid gap-3 sm:grid-cols-2">
        {field("start", "start", "datetime-local")}
        {field("end", "end", "datetime-local")}
        {field("crews", "crews", "number")}
        {field("expires", "expires", "datetime-local")}
        {field("afe", "afe")}
        {field("po", "po")}
      </div>
      <label className="grid gap-1 text-sm" htmlFor={`${id}-attachments`}>
        {t("partnerMarketplace.attachments")}
        <textarea
          id={`${id}-attachments`}
          className="rounded border bg-background p-2"
          value={form.attachments}
          disabled={busy || sent}
          onChange={(e) => {
            setForm({ ...form, attachments: e.target.value });
            setPrepared(false);
            setSaved(null);
          }}
        />
      </label>
      {error && <p role="alert">{t("partnerMarketplace.invalidDraft")}</p>}
      <TogglePillButton
        color="blue"
        type="submit"
        disabled={
          busy ||
          sent ||
          isChecking ||
          !vendor.offer ||
          !vendor.offerable ||
          !vendor.eligibility.eligible
        }
      >
        {t("partnerMarketplace.prepareDraft")}
      </TogglePillButton>
      {prepared && !sent && (
        <p role="status">{t("partnerMarketplace.prepared")}</p>
      )}
      {apiError && <p role="alert">{t("jobOffers.changed")}</p>}
      {saved?.status === "draft" && (
        <section data-card-layout
          aria-label={t("jobOffers.confirmSend")}
          className="space-y-3 rounded border p-3"
        >
          <CardHeading as="h4">{t("jobOffers.confirmSend")}</CardHeading>
          <JobOfferSummary offer={saved} />
          <TogglePillButton
            type="button"
            color="blue"
            disabled={busy || isChecking}
            onClick={() => void send()}
          >
            {t("jobOffers.send")}
          </TogglePillButton>
        </section>
      )}
      {sent && <p role="status">{t("jobOffers.sent")}</p>}
      {saved &&
        ["draft", "offered", "vendor_reviewing"].includes(saved.status) && (
          <TogglePillButton
            type="button"
            color="red"
            disabled={busy}
            onClick={async () => {
              if (busyRef.current) return;
              busyRef.current = true;
              setBusy(true);
              try {
                setSaved(
                  await withdrawMarketplaceJobOffer(saved.id, {
                    version: saved.version,
                  }),
                );
              } catch {
                setApiError(true);
                setSaved(null);
              } finally {
                busyRef.current = false;
                setBusy(false);
              }
            }}
          >
            {t("jobOffers.withdraw")}
          </TogglePillButton>
        )}
      {saved?.status === "withdrawn" && (
        <p role="status">{t("jobOffers.withdrawn")}</p>
      )}
    </form>
  );
}
