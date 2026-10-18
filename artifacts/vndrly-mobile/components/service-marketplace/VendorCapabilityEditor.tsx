import React, { useRef, useState } from "react";
import { Switch } from "react-native";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListVendorMarketplaceCapabilities,
  getListVendorMarketplaceCapabilitiesQueryKey,
  useListVendorMarketplaceServiceAreas,
  useListVendorMarketplaceMatchingDemand,
  createVendorMarketplaceCapability,
  updateVendorMarketplaceCapability,
  previewVendorMarketplaceCapability,
  saveVendorMarketplaceServiceArea,
  clearVendorMarketplaceServiceAreaOverride,
  saveVendorMarketplacePartnerRate,
  type MarketplaceCapability,
  type MarketplaceDemand,
  type PreviewVendorMarketplaceCapability200,
} from "@workspace/api-client-react";
import TogglePillButton from "@/components/TogglePillButton";
import { Field, Label, Panel } from "./primitives";

function radiusFromInput(value: string) {
  const radius = Number(value);
  if (
    !value.trim() ||
    !Number.isFinite(radius) ||
    radius <= 0 ||
    radius > 20000 ||
    Math.abs(radius * 1000 - Math.round(radius * 1000)) > 0.000001
  )
    throw new Error("Invalid radius");
  return radius;
}

function DemandRate({
  vendorId,
  item,
  capability,
  onSaved,
}: {
  vendorId: number;
  item: MarketplaceDemand;
  capability: MarketplaceCapability;
  onSaved: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const own = item.ownOffer;
  const [price, setPrice] = useState(
    own?.unitPrice ?? String(capability.defaultRateCard?.unitPrice ?? ""),
  );
  const [unit, setUnit] = useState(
    own?.unit ?? capability.defaultRateCard?.unit ?? "per_hour",
  );
  const [currency, setCurrency] = useState(
    own?.currency ?? capability.defaultRateCard?.currency ?? "USD",
  );
  const [capacity, setCapacity] = useState(
    String(own?.capacity ?? capability.capacity),
  );
  const [conditions, setConditions] = useState(own?.commercialConditions ?? "");
  const [notes, setNotes] = useState(own?.notes ?? "");
  const [available, setAvailable] = useState(
    own?.availability?.available !== false,
  );
  const [active, setActive] = useState(own?.active ?? true);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState("");
  const save = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (
        !/^\d+(\.\d{1,2})?$/.test(price) ||
        !unit.trim() ||
        !/^[A-Z]{3}$/.test(currency) ||
        !Number.isInteger(Number(capacity)) ||
        Number(capacity) < 1
      )
        throw new Error("Invalid form");
      await saveVendorMarketplacePartnerRate(vendorId, {
        vendorCapabilityId: capability.id,
        workTypeId: item.workTypeId,
        unitPrice: Number(price),
        unit: unit.trim(),
        currency,
        capacity: Number(capacity),
        commercialConditions: conditions.trim() || null,
        notes: notes.trim() || null,
        rateComponents: own?.rateComponents,
        availability: { available },
        active,
      });
      await onSaved();
      setMessage(t("mobileMarketplace.saved"));
    } catch {
      setMessage(t("mobileMarketplace.saveError"));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Panel>
      <Label>
        {item.partnerName} · {item.name}
      </Label>
      <Label>{item.description}</Label>
      <Label>{t("mobileMarketplace.requirements")}</Label>
      <Label>{item.requiredCertifications.join(", ") || "—"}</Label>
      <Label>
        {t("mobileMarketplace.demand", { count: item.approximateDemand })}
      </Label>
      <Label>
        {item.locations.map((location) => location.state ?? "—").join(", ")}
      </Label>
      <Label>
        {item.eligibility.eligible
          ? t("mobileMarketplace.eligible")
          : item.eligibility.reasonCodes
              .map((reason) =>
                t(`mobileMarketplace.reasons.${reason}`, {
                  defaultValue: reason,
                }),
              )
              .join(", ")}
      </Label>
      <Field
        label={t("mobileMarketplace.partnerPrice")}
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
        editable={!busy}
      />
      <Field
        label={t("mobileMarketplace.unit")}
        value={unit}
        onChangeText={setUnit}
        editable={!busy}
      />
      <Field
        label={t("mobileMarketplace.currency")}
        value={currency}
        onChangeText={setCurrency}
        editable={!busy}
      />
      <Field
        label={t("mobileMarketplace.capacity")}
        value={capacity}
        onChangeText={setCapacity}
        keyboardType="number-pad"
        editable={!busy}
      />
      <Field
        label={t("mobileMarketplace.conditions")}
        value={conditions}
        onChangeText={setConditions}
        editable={!busy}
      />
      <Field
        label={t("mobileMarketplace.notes")}
        value={notes}
        onChangeText={setNotes}
        editable={!busy}
      />
      <Label>{t("mobileMarketplace.available")}</Label>
      <Switch
        accessibilityLabel={t("mobileMarketplace.available")}
        value={available}
        onValueChange={setAvailable}
        disabled={busy}
      />
      <Label>{t("mobileMarketplace.activeRate")}</Label>
      <Switch
        accessibilityLabel={t("mobileMarketplace.activeRate")}
        value={active}
        onValueChange={setActive}
        disabled={busy}
      />
      <TogglePillButton disabled={busy} onPress={() => void save()}>
        {t("mobileMarketplace.saveRate")}
      </TogglePillButton>
      {!!message && <Label>{message}</Label>}
    </Panel>
  );
}

function CapabilityForm({
  vendorId,
  capability: loadedCapability,
  onSaved,
}: {
  vendorId: number;
  capability?: MarketplaceCapability;
  onSaved: (result: MarketplaceCapability) => Promise<void>;
}) {
  const { t } = useTranslation();
  // A successful create must remain an update target if staged coverage fails.
  const [created, setCreated] = useState<MarketplaceCapability | null>(null);
  const capability = loadedCapability ?? created ?? undefined;
  const areas = useListVendorMarketplaceServiceAreas(vendorId);
  const [offset, setOffset] = useState(0);
  const demand = useListVendorMarketplaceMatchingDemand(vendorId, {
    limit: 50,
    offset,
  });
  const [name, setName] = useState(capability?.name ?? "");
  const [description, setDescription] = useState(capability?.description ?? "");
  const [capacity, setCapacity] = useState(String(capability?.capacity ?? 1));
  const [active, setActive] = useState(capability?.active ?? true);
  const [qualifications, setQualifications] = useState(
    String(capability?.qualifications?.description ?? ""),
  );
  const [price, setPrice] = useState(
    String(capability?.defaultRateCard?.unitPrice ?? ""),
  );
  const [unit, setUnit] = useState(
    capability?.defaultRateCard?.unit ?? capability?.defaultUnit ?? "per_hour",
  );
  const [currency, setCurrency] = useState(
    capability?.defaultRateCard?.currency ?? "USD",
  );
  const [companyRadius, setCompanyRadius] = useState<string | null>(null);
  const [serviceRadius, setServiceRadius] = useState<string | null>(null);
  const [preview, setPreview] =
    useState<PreviewVendorMarketplaceCapability200 | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [message, setMessage] = useState("");
  const company = areas.data?.items.find(
    (area) =>
      area.active && !area.effectiveUntil && area.vendorCapabilityId === null,
  );
  const service = areas.data?.items.find(
    (area) =>
      area.active &&
      !area.effectiveUntil &&
      area.vendorCapabilityId === capability?.id,
  );
  const wordingDirty =
    !!capability &&
    (name !== capability.name ||
      description !== (capability.description ?? ""));
  const run = async (work: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch {
      setMessage(t("mobileMarketplace.saveError"));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const coverage = (capabilityId: number | null, value: string) =>
    run(async () => {
      const radius = radiusFromInput(value);
      await saveVendorMarketplaceServiceArea(vendorId, {
        vendorCapabilityId: capabilityId,
        radiusMiles: radius,
      });
      await Promise.all([areas.refetch(), demand.refetch()]);
      if (created) await onSaved(created);
      setMessage(t("mobileMarketplace.saved"));
    });
  return (
    <Panel>
      <Field
        label={t("mobileMarketplace.name")}
        value={name}
        onChangeText={(value) => {
          setName(value);
          setPreview(null);
        }}
        editable={!busy}
      />
      <Field
        label={t("mobileMarketplace.description")}
        value={description}
        onChangeText={(value) => {
          setDescription(value);
          setPreview(null);
        }}
        multiline
        editable={!busy}
      />
      <Field
        label={t("mobileMarketplace.capacity")}
        value={capacity}
        onChangeText={setCapacity}
        keyboardType="number-pad"
        editable={!busy}
      />
      <Field
        label={t("mobileMarketplace.qualifications")}
        value={qualifications}
        onChangeText={setQualifications}
        editable={!busy}
      />
      <Field
        label={t("mobileMarketplace.defaultPrice")}
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
        editable={!busy}
      />
      <Field
        label={t("mobileMarketplace.unit")}
        value={unit}
        onChangeText={setUnit}
        editable={!busy}
      />
      <Field
        label={t("mobileMarketplace.currency")}
        value={currency}
        onChangeText={setCurrency}
        editable={!busy}
      />
      <Label>{t("mobileMarketplace.activeCapability")}</Label>
      <Switch
        accessibilityLabel={t("mobileMarketplace.activeCapability")}
        value={active}
        onValueChange={setActive}
        disabled={busy}
      />
      <TogglePillButton
        disabled={busy || !name.trim()}
        onPress={() =>
          void run(async () => {
            setPreview(
              await previewVendorMarketplaceCapability(vendorId, {
                name: name.trim(),
                description: description.trim() || null,
              }),
            );
          })
        }
      >
        {t("mobileMarketplace.preview")}
      </TogglePillButton>
      {preview && (
        <>
          <Label>{preview.explanation}</Label>
          <Label>
            {preview.canonicalServiceName ?? t("mobileMarketplace.pending")}
          </Label>
          <Label>{t("mobileMarketplace.provisional")}</Label>
          {preview.matchingPartnerCount !== null && (
            <Label>
              {t("mobileMarketplace.previewCount", {
                count: preview.matchingPartnerCount,
              })}
            </Label>
          )}
        </>
      )}
      {capability?.mapping && (
        <>
          <Label>
            {capability.mapping.status === "active"
              ? capability.mapping.canonicalServiceName
              : t("mobileMarketplace.pending")}
          </Label>
          <Label>{capability.mapping.explanation}</Label>
        </>
      )}
      <TogglePillButton
        disabled={busy || (!capability && !preview)}
        onPress={() =>
          void run(async () => {
            if (
              !name.trim() ||
              !unit.trim() ||
              !/^[A-Z]{3}$/.test(currency) ||
              !Number.isInteger(Number(capacity)) ||
              Number(capacity) < 1 ||
              (price && !/^\d+(\.\d{1,2})?$/.test(price))
            )
              throw new Error("Invalid capability");
            const data = {
              name: name.trim(),
              description: description.trim() || null,
              capacity: Number(capacity),
              active,
              defaultUnit: unit.trim(),
              defaultRateCard: price
                ? { unitPrice: Number(price), unit: unit.trim(), currency }
                : null,
              qualifications: {
                ...capability?.qualifications,
                description: qualifications.trim(),
              },
            };
            const stagedRadius =
              !loadedCapability && serviceRadius?.trim()
                ? radiusFromInput(serviceRadius)
                : null;
            const result = capability
              ? await updateVendorMarketplaceCapability(
                  vendorId,
                  capability.id,
                  data,
                )
              : await createVendorMarketplaceCapability(vendorId, data);
            if (!loadedCapability) setCreated(result);
            if (stagedRadius !== null)
              await saveVendorMarketplaceServiceArea(vendorId, {
                vendorCapabilityId: result.id,
                radiusMiles: stagedRadius,
              });
            await onSaved(result);
            setMessage(t("mobileMarketplace.saved"));
          })
        }
      >
        {t("mobileMarketplace.saveCapability")}
      </TogglePillButton>
      <Label>{t("mobileMarketplace.coverage")}</Label>
      <Label>{company?.address ?? t("mobileMarketplace.verifyBase")}</Label>
      {!capability && (
        <>
          <Label>{t("mobileMarketplace.stagedCoverage")}</Label>
          <Field
            label={t("mobileMarketplace.serviceRadius")}
            value={serviceRadius ?? ""}
            onChangeText={setServiceRadius}
            keyboardType="decimal-pad"
            editable={!busy}
          />
        </>
      )}
      {(areas.isError || demand.isError) && (
        <Label alert>{t("mobileMarketplace.unavailable")}</Label>
      )}
      <Field
        label={t("mobileMarketplace.companyRadius")}
        value={companyRadius ?? company?.radiusMiles ?? ""}
        onChangeText={setCompanyRadius}
        keyboardType="decimal-pad"
        editable={!busy}
      />
      <TogglePillButton
        disabled={busy}
        onPress={() =>
          void coverage(null, companyRadius ?? company?.radiusMiles ?? "")
        }
      >
        {t("mobileMarketplace.saveCompanyCoverage")}
      </TogglePillButton>
      {capability && (
        <>
          <Label>
            {service
              ? t("mobileMarketplace.override")
              : t("mobileMarketplace.inherited")}
          </Label>
          <Field
            label={t("mobileMarketplace.serviceRadius")}
            value={
              serviceRadius ??
              service?.radiusMiles ??
              company?.radiusMiles ??
              ""
            }
            onChangeText={setServiceRadius}
            keyboardType="decimal-pad"
            editable={!busy}
          />
          <TogglePillButton
            disabled={busy}
            onPress={() =>
              void coverage(
                capability.id,
                serviceRadius ??
                  service?.radiusMiles ??
                  company?.radiusMiles ??
                  "",
              )
            }
          >
            {t("mobileMarketplace.saveServiceCoverage")}
          </TogglePillButton>
          <TogglePillButton
            disabled={busy || !service}
            onPress={() =>
              void run(async () => {
                await clearVendorMarketplaceServiceAreaOverride(
                  vendorId,
                  capability.id,
                );
                await Promise.all([areas.refetch(), demand.refetch()]);
              })
            }
          >
            {t("mobileMarketplace.inheritCoverage")}
          </TogglePillButton>
        </>
      )}
      {!!message && <Label>{message}</Label>}
      {wordingDirty && <Label>{t("mobileMarketplace.wordingChanged")}</Label>}
      {capability?.active &&
        capability.mapping?.status === "active" &&
        !wordingDirty &&
        !demand.isError && (
          <>
            <Label>{t("mobileMarketplace.matchingDemand")}</Label>
            {demand.data?.items
              .filter((item) => item.capabilityId === capability.id)
              .map((item) => (
                <DemandRate
                  key={`${item.partnerId}:${item.workTypeId}:${item.ownOffer?.version}`}
                  vendorId={vendorId}
                  item={item}
                  capability={capability}
                  onSaved={() => demand.refetch()}
                />
              ))}
            <TogglePillButton
              disabled={offset === 0 || busy || demand.isFetching}
              onPress={() => setOffset(Math.max(0, offset - 50))}
            >
              {t("mobileMarketplace.previous")}
            </TogglePillButton>
            <TogglePillButton
              disabled={
                busy ||
                demand.isFetching ||
                (demand.data?.items.length ?? 0) < 50
              }
              onPress={() => setOffset(offset + 50)}
            >
              {t("mobileMarketplace.next")}
            </TogglePillButton>
          </>
        )}
    </Panel>
  );
}

export default function VendorCapabilityEditor({
  vendorId,
}: {
  vendorId: number;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const capabilities = useListVendorMarketplaceCapabilities(vendorId);
  const [selected, setSelected] = useState<number | "new" | null>(null);
  if (capabilities.isError)
    return (
      <Panel>
        <Label alert>{t("mobileMarketplace.unavailable")}</Label>
        <TogglePillButton onPress={() => void capabilities.refetch()}>
          {t("mobileMarketplace.refreshCapabilities")}
        </TogglePillButton>
      </Panel>
    );
  return (
    <Panel>
      <Label>{t("mobileMarketplace.capabilities")}</Label>
      <TogglePillButton
        disabled={capabilities.isFetching}
        onPress={() => void capabilities.refetch()}
      >
        {t("mobileMarketplace.refreshCapabilities")}
      </TogglePillButton>
      <TogglePillButton onPress={() => setSelected("new")}>
        {t("mobileMarketplace.add")}
      </TogglePillButton>
      {capabilities.data?.items.map((item) => (
        <TogglePillButton key={item.id} onPress={() => setSelected(item.id)}>
          {item.name}
        </TogglePillButton>
      ))}
      {selected !== null && (
        <CapabilityForm
          key={selected}
          vendorId={vendorId}
          capability={capabilities.data?.items.find(
            (item) => item.id === selected,
          )}
          onSaved={async (result) => {
            // Preserve canonical create readback even if the following refresh fails.
            queryClient.setQueryData(
              getListVendorMarketplaceCapabilitiesQueryKey(vendorId),
              (current: { items: MarketplaceCapability[] } | undefined) => ({
                items: [
                  ...(current?.items ?? []).filter(
                    (item) => item.id !== result.id,
                  ),
                  result,
                ],
              }),
            );
            setSelected(result.id);
          }}
        />
      )}
    </Panel>
  );
}
