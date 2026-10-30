import { CardHeading } from "@/components/ui/card-heading";
import { BrandedCheckbox } from "./branded-checkbox";
import FleetPolicyEditor from "./fleet-policy-editor";
import React, { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  FleetPricingBasisSchema,
  FleetAdditionalChargeKindSchema,
  FleetQuantityUnitSchema,
  SaveFleetAgreementSchema,
  FleetRateCardRevisionSchema,
  type FleetRateCardRevision,
} from "@workspace/api-zod";
import { PngPillButton } from "./png-pill-rollover";
export function FleetAgreementEditor({
  partnerId,
  vendorId,
  serviceId,
  revision,
  agreement,
  onSaved,
}: {
  partnerId: number;
  vendorId: number;
  serviceId: number;
  revision: string;
  agreement: FleetRateCardRevision | null;
  onSaved?: (card: FleetRateCardRevision) => void;
}) {
  const { i18n } = useTranslation();
  async function send(path: string, input: unknown) {
    const r = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!r.ok) throw Error(`Agreement ${r.status}`);
    return r.json();
  }

  const es = (i18n?.language ?? "en").startsWith("es"),
    [terms, setTerms] = useState(() =>
      agreement
        ? {
            basis: agreement.basis,
            unitRate: agreement.unitRate,
            effectiveFrom: agreement.effectiveFrom,
            effectiveUntil: agreement.effectiveUntil,
            minimum: agreement.minimum,
            detention: agreement.detention,
            extras: agreement.extras,
            notes: agreement.notes,
          }
        : {
            basis: "per_load" as const,
            unitRate: "",
            effectiveFrom: new Date().toISOString(),
            effectiveUntil: null,
            minimum: null,
            detention: null,
            extras: [],
            notes: "",
          },
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const operation = useRef<string | null>(null);
  const [eligibleText, setEligibleText] = useState<Record<number, string>>({});
  function change(next: typeof terms) {
    operation.current = null;
    setTerms(next);
  }
  async function save() {
    setBusy(true);
    try {
      operation.current ??= crypto.randomUUID();
      const input = SaveFleetAgreementSchema.parse({
        operationId: operation.current,
        expectedApprovalRevision: revision,
        terms,
      });
      const saved = FleetRateCardRevisionSchema.parse(
        await send(
          `/api/partners/${partnerId}/work-types/${serviceId}/vendor-approvals/${vendorId}/fleet-agreement`,
          input,
        ),
      );
      setMessage(
        es
          ? "Acuerdo aprobado y verificado"
          : "Agreement approved and verified",
      );
      onSaved?.(saved);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : es
            ? "No se guardó"
            : "Not saved",
      );
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, value: string, set: (v: string) => void) => (
    <label className="block">
      {label}
      <input
        aria-label={label}
        value={value}
        disabled={busy}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
  return (
    <section data-card-layout className="fleet-card p-4 space-y-3">
      <CardHeading as="h4">{es ? "Acuerdo de transporte" : "Transport agreement"}</CardHeading>
      <p>
        {es
          ? "USD. Cambiar términos no modifica trabajo anterior. Se requiere aprobación del socio."
          : "USD. Changed terms never rewrite earlier work. Partner approval is required."}
      </p>
      <label>
        {es ? "Base" : "Basis"}
        <select
          value={terms.basis}
          disabled={busy}
          onChange={(e) =>
            change({ ...terms, basis: e.target.value as typeof terms.basis })
          }
        >
          {FleetPricingBasisSchema.options.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      {field(es ? "Tarifa exacta" : "Exact rate", terms.unitRate, (v) =>
        change({ ...terms, unitRate: v }),
      )}
      {field(
        es ? "Vigente desde (ISO)" : "Effective from (ISO)",
        terms.effectiveFrom,
        (v) => change({ ...terms, effectiveFrom: v }),
      )}
      {field(
        es ? "Vigente hasta (opcional)" : "Effective until (optional)",
        terms.effectiveUntil ?? "",
        (v) => change({ ...terms, effectiveUntil: v || null }),
      )}
      {field(
        es ? "Mínimo (opcional)" : "Minimum amount (optional)",
        terms.minimum?.amount ?? "",
        (v) =>
          change({
            ...terms,
            minimum: v
              ? { amount: v, scope: terms.minimum?.scope ?? "run" }
              : null,
          }),
      )}
      {terms.minimum && (
        <select
          aria-label={es ? "Alcance del mínimo" : "Minimum scope"}
          value={terms.minimum.scope}
          onChange={(e) =>
            change({
              ...terms,
              minimum: { ...terms.minimum!, scope: e.target.value as "run" },
            })
          }
        >
          {["run", "load", "day", "ticket"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      )}
      {field(
        es ? "Espera por hora (opcional)" : "Detention hourly rate (optional)",
        terms.detention?.ratePerHour ?? "",
        (v) =>
          change({
            ...terms,
            detention: v
              ? {
                  ratePerHour: v,
                  freeMinutes: terms.detention?.freeMinutes ?? "0",
                  incrementMinutes: terms.detention?.incrementMinutes ?? "1",
                  rounding: terms.detention?.rounding ?? "half_away_from_zero",
                  allowHourlyOverlap:
                    terms.detention?.allowHourlyOverlap ?? false,
                }
              : null,
          }),
      )}
      {terms.detention && (
        <>
          {field(
            es ? "Minutos gratuitos" : "Free minutes",
            terms.detention.freeMinutes,
            (v) =>
              change({
                ...terms,
                detention: { ...terms.detention!, freeMinutes: v },
              }),
          )}
          {field(
            es ? "Incremento en minutos" : "Minute increment",
            terms.detention.incrementMinutes,
            (v) =>
              change({
                ...terms,
                detention: { ...terms.detention!, incrementMinutes: v },
              }),
          )}
          <select
            aria-label="Detention rounding"
            value={terms.detention.rounding}
            onChange={(e) =>
              change({
                ...terms,
                detention: {
                  ...terms.detention!,
                  rounding: e.target.value as "half_away_from_zero",
                },
              })
            }
          >
            {["half_away_from_zero", "toward_zero", "away_from_zero"].map(
              (x) => (
                <option key={x}>{x}</option>
              ),
            )}
          </select>
        </>
      )}
      {terms.detention && (
        <label className="flex items-center gap-2">
          <BrandedCheckbox
            disabled={busy}
            checked={terms.detention.allowHourlyOverlap}
            onCheckedChange={(value) =>
              change({
                ...terms,
                detention: {
                  ...terms.detention!,
                  allowHourlyOverlap: value === true,
                },
              })
            }
          />
          {es
            ? "Permitir espera y servicio por hora superpuestos"
            : "Allow detention and hourly service to overlap"}
        </label>
      )}
      {terms.extras.map((extra, index) => {
        const update = (patch: Partial<typeof extra>) =>
          change({
            ...terms,
            extras: terms.extras.map((x, i) =>
              i === index ? { ...x, ...patch } : x,
            ),
          });
        return (
          <div className="fleet-detail-group space-y-2" key={index}>
            {field(
              es ? `Código de cargo ${index + 1}` : `Charge code ${index + 1}`,
              extra.code,
              (code) => update({ code }),
            )}
            <label>
              {es ? "Tipo de cargo" : "Charge kind"}
              <select
                aria-label={
                  es ? `Tipo de cargo ${index + 1}` : `Charge kind ${index + 1}`
                }
                disabled={busy}
                value={extra.kind}
                onChange={(e) =>
                  update({ kind: e.target.value as typeof extra.kind })
                }
              >
                {FleetAdditionalChargeKindSchema.options.map((x) => (
                  <option key={x} value={x}>
                    {x.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {es ? "Base del cargo" : "Charge basis"}
              <select
                aria-label={
                  es
                    ? `Base del cargo ${index + 1}`
                    : `Charge basis ${index + 1}`
                }
                disabled={busy}
                value={extra.basis}
                onChange={(e) => {
                  const basis = e.target.value as typeof extra.basis;
                  update({
                    basis,
                    unit: basis === "per_unit" ? (extra.unit ?? "load") : null,
                  });
                }}
              >
                {(["flat", "per_unit", "percent"] as const).map((x) => (
                  <option key={x} value={x}>
                    {
                      {
                        flat: es ? "Importe fijo" : "Flat amount",
                        per_unit: es ? "Por unidad" : "Per unit",
                        percent: es ? "Porcentaje" : "Percentage",
                      }[x]
                    }
                  </option>
                ))}
              </select>
            </label>
            {field(
              es ? `Tarifa del cargo ${index + 1}` : `Charge rate ${index + 1}`,
              extra.rate,
              (rate) => update({ rate }),
            )}
            {extra.basis === "per_unit" && (
              <label>
                {es ? "Unidad" : "Unit"}
                <select
                  aria-label={
                    es
                      ? `Unidad del cargo ${index + 1}`
                      : `Charge unit ${index + 1}`
                  }
                  disabled={busy}
                  value={extra.unit ?? ""}
                  onChange={(e) =>
                    update({
                      unit: e.target.value as NonNullable<typeof extra.unit>,
                    })
                  }
                >
                  {FleetQuantityUnitSchema.options.map((x) => (
                    <option key={x} value={x}>
                      {x.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {extra.basis === "percent" && (
              <>
                {field(
                  es
                    ? `Códigos de cargos elegibles ${index + 1}`
                    : `Eligible charge codes ${index + 1}`,
                  eligibleText[index] ?? extra.eligibleChargeCodes.join(", "),
                  (value) => {
                    setEligibleText((prior) => ({ ...prior, [index]: value }));
                    update({
                      eligibleChargeCodes: [
                        ...new Set(
                          value
                            .split(",")
                            .map((x) => x.trim())
                            .filter(Boolean),
                        ),
                      ],
                    });
                  },
                )}
                <p>
                  {es
                    ? "Separe por comas: primary, detention, minimum o códigos explícitos de otros cargos. No se eligen bases automáticamente."
                    : "Separate with commas: primary, detention, minimum, or explicit other charge codes. Bases are never selected automatically."}
                </p>
              </>
            )}
            {field(
              es
                ? `Referencia del acuerdo ${index + 1}`
                : `Agreement reference ${index + 1}`,
              extra.agreementReference,
              (agreementReference) => update({ agreementReference }),
            )}
            <label className="flex items-center gap-2">
              <BrandedCheckbox
                disabled={busy}
                checked={extra.requiresApproval}
                onCheckedChange={(checked) =>
                  update({ requiresApproval: checked === true })
                }
              />
              {es
                ? "Requiere aprobación del cargo"
                : "Charge approval required"}
            </label>
            <PngPillButton
              disabled={busy}
              onClick={() => {
                setEligibleText({});
                change({
                  ...terms,
                  extras: terms.extras.filter((_, i) => i !== index),
                });
              }}
            >
              {es ? "Quitar cargo" : "Remove charge"}
            </PngPillButton>
          </div>
        );
      })}

      <PngPillButton
        disabled={busy}
        onClick={() =>
          change({
            ...terms,
            extras: [
              ...terms.extras,
              {
                code: "",
                kind: "mobilization",
                basis: "flat",
                rate: "",
                unit: null,
                eligibleChargeCodes: [],
                requiresApproval: true,
                agreementReference: "",
              },
            ],
          })
        }
      >
        {es ? "Agregar cargo" : "Add charge"}
      </PngPillButton>
      {field(es ? "Notas del acuerdo" : "Agreement notes", terms.notes, (v) =>
        change({ ...terms, notes: v }),
      )}
      <PngPillButton disabled={busy} onClick={() => void save()}>
        {es ? "Aprobar acuerdo" : "Approve agreement"}
      </PngPillButton>
      <p role="status">{message}</p>
      <FleetPolicyEditor partnerId={partnerId} vendorId={vendorId} serviceId={serviceId}/>
    </section>
  );
}
