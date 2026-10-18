import FleetChoiceField from "./FleetChoiceField";
import FleetPolicyEditor from "./FleetPolicyEditor";
import FleetCheckbox from "./FleetCheckbox";
import React, { useState, useRef } from "react";
import { Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as Crypto from "expo-crypto";
import {
  SaveFleetAgreementSchema,
  FleetRateCardRevisionSchema,
  FleetPricingBasisSchema,
  FleetAdditionalChargeKindSchema,
  FleetQuantityUnitSchema,
  type FleetRateCardRevision,
} from "@workspace/api-zod";
import { apiFetch } from "@/lib/api";
import { useColors } from "@/hooks/useColors";
import TogglePillButton from "./TogglePillButton";
export default function FleetAgreementEditor({
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
  const { i18n } = useTranslation(),
    colors = useColors();
  const send = (path: string, input: unknown) =>
    apiFetch(path, { method: "POST", body: JSON.stringify(input) });

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
      operation.current ??= Crypto.randomUUID();
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
    <View>
      <Text style={{ color: colors.text }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        editable={!busy}
        onChangeText={set}
        style={{
          color: colors.text,
          borderWidth: 2,
          borderColor: colors.primary,
          borderRadius: 8,
          padding: 10,
        }}
      />
    </View>
  );
  return (
    <View
      style={{
        gap: 10,
        padding: 14,
        borderWidth: 2,
        borderColor: colors.primary,
        backgroundColor: colors.card,
        borderRadius: 12,
      }}
    >
      <Text style={{ color: colors.text }}>
        {es ? "Acuerdo de transporte · USD" : "Transport agreement · USD"}
      </Text>
      <Text style={{ color: colors.text }}>
        {es
          ? "No modifica trabajo anterior. Aprobación del socio."
          : "Earlier work is unchanged. Partner approval."}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {FleetPricingBasisSchema.options.map((basis) => (
          <TogglePillButton
            key={basis}
            disabled={busy}
            solid={terms.basis === basis}
            onPress={() => change({ ...terms, basis })}
          >
            {basis}
          </TogglePillButton>
        ))}
      </View>
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
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {(["run", "load", "day", "ticket"] as const).map((scope) => (
            <TogglePillButton
              key={scope}
              solid={terms.minimum?.scope === scope}
              onPress={() =>
                change({ ...terms, minimum: { ...terms.minimum!, scope } })
              }
            >
              {scope}
            </TogglePillButton>
          ))}
        </View>
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
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {(
              ["half_away_from_zero", "toward_zero", "away_from_zero"] as const
            ).map((rounding) => (
              <TogglePillButton
                key={rounding}
                solid={terms.detention?.rounding === rounding}
                onPress={() =>
                  change({
                    ...terms,
                    detention: { ...terms.detention!, rounding },
                  })
                }
              >
                {rounding}
              </TogglePillButton>
            ))}
          </View>
        </>
      )}
      {terms.detention && (
        <FleetCheckbox
          label={
            es
              ? "Permitir espera y servicio por hora superpuestos"
              : "Allow detention and hourly service to overlap"
          }
          checked={terms.detention.allowHourlyOverlap}
          disabled={busy}
          onChange={(allowHourlyOverlap) =>
            change({
              ...terms,
              detention: { ...terms.detention!, allowHourlyOverlap },
            })
          }
        />
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
          <View
            key={index}
            style={{
              gap: 8,
              padding: 12,
              borderWidth: 2,
              borderColor: colors.primary,
              borderRadius: 10,
            }}
          >
            {field(
              es ? `Código de cargo ${index + 1}` : `Charge code ${index + 1}`,
              extra.code,
              (code) => update({ code }),
            )}
            <FleetChoiceField
              label={
                es ? `Tipo de cargo ${index + 1}` : `Charge kind ${index + 1}`
              }
              disabled={busy}
              value={extra.kind}
              options={FleetAdditionalChargeKindSchema.options.map((id) => ({
                id,
                label: id.replaceAll("_", " "),
              }))}
              onChange={(kind) => update({ kind: kind as typeof extra.kind })}
            />
            <FleetChoiceField
              label={
                es ? `Base del cargo ${index + 1}` : `Charge basis ${index + 1}`
              }
              disabled={busy}
              value={extra.basis}
              options={(["flat", "per_unit", "percent"] as const).map((id) => ({
                id,
                label: {
                  flat: es ? "Importe fijo" : "Flat amount",
                  per_unit: es ? "Por unidad" : "Per unit",
                  percent: es ? "Porcentaje" : "Percentage",
                }[id],
              }))}
              onChange={(value) => {
                const basis = value as typeof extra.basis;
                update({
                  basis,
                  unit: basis === "per_unit" ? (extra.unit ?? "load") : null,
                });
              }}
            />
            {field(
              es ? `Tarifa del cargo ${index + 1}` : `Charge rate ${index + 1}`,
              extra.rate,
              (rate) => update({ rate }),
            )}
            {extra.basis === "per_unit" && (
              <FleetChoiceField
                label={
                  es
                    ? `Unidad del cargo ${index + 1}`
                    : `Charge unit ${index + 1}`
                }
                disabled={busy}
                value={extra.unit ?? ""}
                options={FleetQuantityUnitSchema.options.map((id) => ({
                  id,
                  label: id.replaceAll("_", " "),
                }))}
                onChange={(unit) =>
                  update({ unit: unit as NonNullable<typeof extra.unit> })
                }
              />
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
                <Text style={{ color: colors.text }}>
                  {es
                    ? "Separe por comas: primary, detention, minimum o códigos explícitos de otros cargos. No se eligen bases automáticamente."
                    : "Separate with commas: primary, detention, minimum, or explicit other charge codes. Bases are never selected automatically."}
                </Text>
              </>
            )}
            {field(
              es
                ? `Referencia del acuerdo ${index + 1}`
                : `Agreement reference ${index + 1}`,
              extra.agreementReference,
              (agreementReference) => update({ agreementReference }),
            )}
            <FleetCheckbox
              label={
                es
                  ? "Requiere aprobación del cargo"
                  : "Charge approval required"
              }
              checked={extra.requiresApproval}
              disabled={busy}
              onChange={(requiresApproval) => update({ requiresApproval })}
            />
            <TogglePillButton
              disabled={busy}
              onPress={() => {
                setEligibleText({});
                change({
                  ...terms,
                  extras: terms.extras.filter((_, i) => i !== index),
                });
              }}
            >
              {es ? "Quitar cargo" : "Remove charge"}
            </TogglePillButton>
          </View>
        );
      })}

      <TogglePillButton
        disabled={busy}
        onPress={() =>
          change({
            ...terms,
            extras: [
              ...terms.extras,
              {
                code: `extra-${terms.extras.length + 1}`,
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
      </TogglePillButton>
      {field(es ? "Notas" : "Agreement notes", terms.notes, (v) =>
        change({ ...terms, notes: v }),
      )}
      <TogglePillButton disabled={busy} onPress={() => void save()}>
        {es ? "Aprobar acuerdo" : "Approve agreement"}
      </TogglePillButton>
      <Text style={{ color: colors.text }}>{message}</Text>
      <FleetPolicyEditor partnerId={partnerId} vendorId={vendorId} serviceId={serviceId}/>
    </View>
  );
}
