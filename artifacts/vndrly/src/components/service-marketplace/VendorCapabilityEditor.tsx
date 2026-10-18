import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  useListVendorMarketplaceCapabilities,
  useCreateVendorMarketplaceCapability,
  useUpdateVendorMarketplaceCapability,
  usePreviewVendorMarketplaceCapability,
  useSaveVendorMarketplaceServiceArea,
  getListVendorMarketplaceServiceAreasQueryKey,
  useListVendorMarketplaceMatchingDemand,
  getListVendorMarketplaceCapabilitiesQueryKey,
  getListVendorMarketplaceMatchingDemandQueryKey,
  type MarketplaceCapability,
  type MarketplaceCapabilityInput,
  type PreviewVendorMarketplaceCapability200,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PngPillButton } from "@/components/png-pill-rollover";
import ImagePill from "@/components/image-pill";
import { translateApiError } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import ServiceAreaEditor, {
  validServiceRadius,
  type ServiceAreaDraft,
} from "./ServiceAreaEditor";
import MatchingPartnerDemand, {
  type PartnerRateDraft,
} from "./MatchingPartnerDemand";

type Draft = {
  name: string;
  description: string;
  capacity: string;
  qualifications: string;
  price: string;
  unit: string;
  currency: string;
};
const toDraft = (capability?: MarketplaceCapability): Draft => ({
  name: capability?.name ?? "",
  description: capability?.description ?? "",
  capacity: String(capability?.capacity ?? 1),
  qualifications: String(capability?.qualifications?.description ?? ""),
  price: String(capability?.defaultRateCard?.unitPrice ?? ""),
  unit:
    capability?.defaultRateCard?.unit ?? capability?.defaultUnit ?? "per_hour",
  currency: capability?.defaultRateCard?.currency ?? "USD",
});

export default function VendorCapabilityEditor({
  vendorId,
}: {
  vendorId: number;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const capabilities = useListVendorMarketplaceCapabilities(vendorId);
  const create = useCreateVendorMarketplaceCapability();
  const update = useUpdateVendorMarketplaceCapability();
  const preview = usePreviewVendorMarketplaceCapability();
  const saveCoverage = useSaveVendorMarketplaceServiceArea();
  const [selected, setSelected] = useState<number | "new" | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [saving, setSaving] = useState(false);
  const [previewReadback, setPreviewReadback] = useState<{
    key: string;
    result: PreviewVendorMarketplaceCapability200;
  } | null>(null);
  // Scoped to this mounted vendor editor; no browser storage or cross-company draft sharing.
  const coverageDrafts = useRef(new Map<string, ServiceAreaDraft>());
  const rateDrafts = useRef(new Map<string, PartnerRateDraft>());
  const saved = capabilities.data?.items.find((item) => item.id === selected);
  const draft = selected === null ? null : (drafts[selected] ?? toDraft(saved));
  const wordingDirty =
    !!saved &&
    !!draft &&
    (draft.name.trim() !== saved.name ||
      draft.description.trim() !== (saved.description ?? ""));
  const activeMatch =
    saved?.active && saved.mapping?.status === "active" && !wordingDirty;
  const demand = useListVendorMarketplaceMatchingDemand(
    vendorId,
    { limit: 50, offset },
    {
      query: {
        enabled: !!activeMatch,
        queryKey: getListVendorMarketplaceMatchingDemandQueryKey(vendorId, {
          limit: 50,
          offset,
        }),
      },
    },
  );
  const matches =
    demand.data?.items.filter((item) => item.capabilityId === saved?.id) ?? [];
  const busy =
    saving || create.isPending || update.isPending || preview.isPending;
  const previewKey = JSON.stringify([
    draft?.name.trim(),
    draft?.description.trim() || null,
  ]);
  const currentPreview =
    selected === "new" && previewReadback?.key === previewKey
      ? previewReadback.result
      : null;
  const edit = (value: number | "new") => {
    setPreviewReadback(null);
    setSelected(value);
    setOffset(0);
    setError(null);
  };
  const change = (key: keyof Draft, value: string) => {
    if (selected !== null && draft)
      setDrafts((current) => ({
        ...current,
        [selected]: { ...draft, [key]: value },
      }));
  };
  const previewMatch = async () => {
    if (!draft?.name.trim()) return;
    setError(null);
    try {
      const result = await preview.mutateAsync({
        vendorId,
        data: {
          name: draft.name.trim(),
          description: draft.description.trim() || null,
        },
      });
      setPreviewReadback({ key: previewKey, result });
    } catch (e) {
      setError(translateApiError(e, t, t("marketplace.previewError")));
    }
  };
  const save = async () => {
    if (!draft || busy || (selected === "new" && !currentPreview)) return;
    const stagedCoverage =
      selected === "new"
        ? coverageDrafts.current.get(`${vendorId}:new`)
        : undefined;
    if (
      stagedCoverage?.override &&
      !validServiceRadius(stagedCoverage.service ?? "")
    ) {
      setError(t("marketplace.radiusInvalid"));
      return;
    }
    const capacity = Number(draft.capacity);
    if (
      !draft.name.trim() ||
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      capacity > 100000 ||
      (draft.price.trim() &&
        (!/^\d+(\.\d{1,2})?$/.test(draft.price.trim()) ||
          Number(draft.price) > 9999999999.99)) ||
      !draft.unit.trim() ||
      !/^[A-Z]{3}$/.test(draft.currency)
    ) {
      setError(t("marketplace.capabilityInvalid"));
      return;
    }
    const data: MarketplaceCapabilityInput = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      capacity,
      defaultUnit: draft.unit,
      defaultRateCard: draft.price.trim()
        ? {
            unitPrice: Number(draft.price),
            unit: draft.unit,
            currency: draft.currency,
          }
        : null,
      qualifications: {
        ...saved?.qualifications,
        description: draft.qualifications.trim(),
      },
      ...(selected === "new" ? { active: true } : {}),
    };
    setError(null);
    setSaving(true);
    try {
      const result =
        selected === "new"
          ? await create.mutateAsync({ vendorId, data })
          : await update.mutateAsync({
              vendorId,
              capabilityId: Number(selected),
              data,
            });
      if (selected === "new" && stagedCoverage) {
        // Transfer before the ID-keyed editor mounts, including unsaved radius and override choice.
        coverageDrafts.current.set(`${vendorId}:${result.id}`, {
          ...stagedCoverage,
        });
        coverageDrafts.current.delete(`${vendorId}:new`);
      }
      setSelected(result.id);
      setDrafts((current) => {
        const next: Record<string, Draft> = {
          ...current,
          [result.id]: toDraft(result),
        };
        if (selected === "new") delete next.new;
        return next;
      });
      qc.setQueryData(
        getListVendorMarketplaceCapabilitiesQueryKey(vendorId),
        (previous: { items: MarketplaceCapability[] } | undefined) => ({
          items: [
            ...(previous?.items.filter((item) => item.id !== result.id) ?? []),
            result,
          ],
        }),
      );
      if (selected === "new" && stagedCoverage?.override) {
        try {
          await saveCoverage.mutateAsync({
            vendorId,
            data: {
              vendorCapabilityId: result.id,
              radiusMiles: Number(stagedCoverage.service),
            },
          });
        } catch {
          setError(t("marketplace.coverageAfterSaveError"));
        }
      }
      await Promise.all([
        qc.invalidateQueries({
          queryKey: getListVendorMarketplaceServiceAreasQueryKey(vendorId),
        }),
        qc.invalidateQueries({
          queryKey: getListVendorMarketplaceCapabilitiesQueryKey(vendorId),
        }),
        qc.invalidateQueries({
          queryKey: getListVendorMarketplaceMatchingDemandQueryKey(vendorId),
        }),
      ]);
      toast({ title: t("marketplace.capabilitySaved") });
    } catch (e) {
      setError(translateApiError(e, t, t("marketplace.saveError")));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card data-testid="vendor-service-marketplace">
      <CardHeader>
        <CardTitle>{t("marketplace.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("marketplace.subtitle")}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {capabilities.isPending ? (
          <p role="status">{t("marketplace.loading")}</p>
        ) : capabilities.isError ? (
          <p role="alert">
            {translateApiError(
              capabilities.error,
              t,
              t("marketplace.loadError"),
            )}
          </p>
        ) : (
          <>
            <PngPillButton
              color="blue"
              disabled={busy}
              onClick={() => edit("new")}
            >
              {t("marketplace.add")}
            </PngPillButton>
            {capabilities.data.items.length === 0 && (
              <p className="text-sm">{t("marketplace.empty")}</p>
            )}
            <div className="space-y-2">
              {capabilities.data.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 border rounded p-3"
                >
                  <span className="flex-1">{item.name}</span>
                  <PngPillButton
                    color="blue"
                    disabled={busy}
                    onClick={() => edit(item.id)}
                    aria-label={t("marketplace.editNamed", { name: item.name })}
                  >
                    {t("marketplace.edit")}
                  </PngPillButton>
                </div>
              ))}
            </div>
          </>
        )}
        {selected === null && (
          <ServiceAreaEditor
            vendorId={vendorId}
            draftCache={coverageDrafts.current}
          />
        )}
        {draft && (
          <div className="space-y-4">
            <fieldset className="space-y-3" disabled={busy}>
              <legend className="font-semibold">
                {t("marketplace.capabilityDetails")}
              </legend>
              <label className="block text-sm">
                {t("marketplace.serviceName")}
                <Input
                  maxLength={200}
                  value={draft.name}
                  onChange={(e) => change("name", e.target.value)}
                />
              </label>
              <label className="block text-sm">
                {t("marketplace.description")}
                <Textarea
                  maxLength={2000}
                  value={draft.description}
                  onChange={(e) => change("description", e.target.value)}
                />
              </label>
              <label className="block text-sm">
                {t("marketplace.crews")}
                <Input
                  type="number"
                  min="1"
                  max="100000"
                  step="1"
                  value={draft.capacity}
                  onChange={(e) => change("capacity", e.target.value)}
                />
              </label>
              <label className="block text-sm">
                {t("marketplace.qualifications")}
                <Textarea
                  maxLength={2000}
                  value={draft.qualifications}
                  onChange={(e) => change("qualifications", e.target.value)}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                {t("marketplace.qualificationsHelp")}
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-sm">
                  {t("marketplace.defaultPrice")}
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft.price}
                    onChange={(e) => change("price", e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  {t("marketplace.unit")}
                  <select
                    className="block w-full rounded border bg-background p-2"
                    value={draft.unit}
                    onChange={(e) => change("unit", e.target.value)}
                  >
                    {Array.from(
                      new Set([
                        "per_hour",
                        "per_day",
                        "per_job",
                        "lump_sum",
                        draft.unit,
                      ]),
                    ).map((value) => (
                      <option key={value} value={value}>
                        {[
                          "per_hour",
                          "per_day",
                          "per_job",
                          "lump_sum",
                        ].includes(value)
                          ? t(`vendorCatalog.units.${value}`)
                          : value}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  {t("marketplace.currency")}
                  <Input
                    maxLength={3}
                    value={draft.currency}
                    onChange={(e) =>
                      change("currency", e.target.value.toUpperCase())
                    }
                  />
                </label>
              </div>
              {!saved && (
                <p className="text-sm">{t("marketplace.matchAfterSave")}</p>
              )}
              {selected === "new" && (
                <>
                  <PngPillButton
                    color="blue"
                    disabled={!draft.name.trim()}
                    onClick={() => void previewMatch()}
                  >
                    {preview.isPending
                      ? t("marketplace.loading")
                      : t("marketplace.previewMatch")}
                  </PngPillButton>
                  {currentPreview && (
                    <div className="space-y-2 text-sm" aria-live="polite">
                      <p className="text-muted-foreground">
                        {t("marketplace.previewProvisional")}
                      </p>
                      <ImagePill color="amber">
                        {currentPreview.status === "matched"
                          ? t("marketplace.previewMatched")
                          : currentPreview.status === "rejected"
                            ? t("marketplace.matchRejected")
                            : t("marketplace.pendingReview")}
                      </ImagePill>
                      {currentPreview.canonicalServiceName && (
                        <p className="font-medium">
                          {currentPreview.canonicalServiceName}
                        </p>
                      )}
                      {currentPreview.status !== "pending" && (
                        <p>{currentPreview.explanation}</p>
                      )}
                      <p>
                        {currentPreview.matchingPartnerCount === null
                          ? t("marketplace.previewCountUnknown")
                          : t("marketplace.matchCount", {
                              count: currentPreview.matchingPartnerCount,
                            })}
                      </p>
                    </div>
                  )}
                </>
              )}
              {wordingDirty && (
                <p role="status" className="text-sm">
                  {t("marketplace.wordingChanged")}
                </p>
              )}
              <PngPillButton
                color="blue"
                disabled={selected === "new" && !currentPreview}
                onClick={() => void save()}
              >
                {busy ? t("marketplace.saving") : t("marketplace.saveAndMatch")}
              </PngPillButton>
            </fieldset>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {saved && !wordingDirty && (
              <div className="space-y-2" aria-live="polite">
                <ImagePill
                  color={
                    !saved.active ? "grey" : activeMatch ? "green" : "amber"
                  }
                >
                  {!saved.active
                    ? t("marketplace.capabilityInactive")
                    : activeMatch
                      ? t("marketplace.matchActive")
                      : saved.mapping?.status === "rejected"
                        ? t("marketplace.matchRejected")
                        : t("marketplace.pendingReview")}
                </ImagePill>
                {saved.mapping?.canonicalServiceName && (
                  <p className="font-medium">
                    {saved.mapping.canonicalServiceName}
                  </p>
                )}
                {saved.mapping?.explanation && (
                  <p className="text-sm">{saved.mapping.explanation}</p>
                )}
                {activeMatch &&
                  (demand.isPending ? (
                    <p role="status">{t("marketplace.loading")}</p>
                  ) : demand.isError ? (
                    <p role="alert">{t("marketplace.loadError")}</p>
                  ) : (
                    <p className="text-sm">
                      {t("marketplace.matchCount", { count: matches.length })}
                    </p>
                  ))}
              </div>
            )}
            <ServiceAreaEditor
              key={`${vendorId}:${saved?.id ?? "new"}`}
              vendorId={vendorId}
              capabilityId={saved?.id}
              creating={selected === "new"}
              disabled={busy}
              draftCache={coverageDrafts.current}
              onSaved={() =>
                setError((current) =>
                  current === t("marketplace.coverageAfterSaveError")
                    ? null
                    : current,
                )
              }
            />
            {activeMatch && demand.data && (
              <>
                <MatchingPartnerDemand
                  vendorId={vendorId}
                  capability={saved}
                  items={matches}
                  draftCache={rateDrafts.current}
                />
                <div className="flex gap-2">
                  <PngPillButton
                    color="blue"
                    disabled={offset === 0}
                    onClick={() =>
                      setOffset((value) => Math.max(0, value - 50))
                    }
                  >
                    {t("marketplace.previous")}
                  </PngPillButton>
                  <PngPillButton
                    color="blue"
                    disabled={demand.data.items.length < 50}
                    onClick={() => setOffset((value) => value + 50)}
                  >
                    {t("marketplace.next")}
                  </PngPillButton>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("marketplace.pageCountHelp")}
                </p>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
