import React, { useState } from "react";
import { useGateCompany } from "@/hooks/use-gate-company";
import { Text, View } from "react-native";
import { useAuth } from "@/hooks/use-auth";
import { useGateQuery } from "@/hooks/use-gate-query";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import {
  GatePage,
  GateCard,
  GateField,
  GateRow,
  GateError,
  GateLoading,
  gateStyle,
  useGateCopy,
} from "@/components/gate/GateChrome";
import TogglePillButton from "@/components/TogglePillButton";
type Service = {
  id: number;
  name: string;
  category: string | null;
  partnerId: number;
  partnerName: string;
  selected: boolean;
  unitPrice: string | null;
  unit: string | null;
  currency: string | null;
  notes: string | null;
};
export default function GateServices() {
  const c = useGateCopy(),
    { user, activeMembership } = useAuth();
  const vendorId = useGateCompany();
  return <Services key={[user?.id, activeMembership?.id, vendorId].join(":")} />;
}
function Services() {
  const c = useGateCopy(),
    { user } = useAuth(),
    [search, setSearch] = useState(""),
    [editing, setEditing] = useState<Service | null>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const vendorId = useGateCompany();
  const path = "/api/vendors/" + vendorId + "/work-types",
    query = useGateQuery<{ items: Service[] }>(path, !!vendorId);
  async function save() {
    if (!editing || busy) return;
    if (
      editing.unitPrice === null ||
      !/^\d+(\.\d{1,2})?$/.test(editing.unitPrice) ||
      Number(editing.unitPrice) > 9999999999.99
    ) {
      setError(
        c(
          "Enter a valid non-negative price with up to two decimals.",
          "Ingresa un precio válido con hasta dos decimales.",
        ),
      );
      return;
    }
    const scope = captureAuthScope();
    setBusy(true);
    setError("");
    try {
      await apiFetch(
        path + "/" + editing.id + "/price",
        {
          method: "PUT",
          body: JSON.stringify({
            partnerId: editing.partnerId,
            unitPrice: editing.unitPrice,
            unit: editing.unit,
            currency: editing.currency ?? "USD",
            notes: editing.notes,
            priceChangeReason: reason,
          }),
        },
        scope,
      );
      if (!isAuthScopeCurrent(scope)) return;
      const result = await query.refetch();
      if (result.error) throw result.error;
      setEditing(null);
      setReason("");
      setNotice(c("Service rate saved.", "Tarifa de servicio guardada."));
    } catch (e) {
      if (isAuthScopeCurrent(scope))
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isAuthScopeCurrent(scope)) setBusy(false);
    }
  }
  return (
    <GatePage title={c("Services and rates", "Servicios y tarifas")} back>
      <GateError
        message={error || query.error?.message}
        retry={() => void query.refetch()}
      />
      {notice && (
        <Text accessibilityRole="alert" style={gateStyle.text}>
          {notice}
        </Text>
      )}
      {query.isLoading && <GateLoading />}
      <GateCard
        title={c("Selected company services", "Servicios seleccionados")}
        icon="briefcase"
      >
        <GateField
          label={c("Find service", "Buscar servicio")}
          value={search}
          onChangeText={setSearch}
        />
        {query.data?.items
          .filter(
            (s) =>
              s.selected &&
              /gate/i.test(s.name + " " + (s.category ?? "")) &&
              (s.name + " " + s.partnerName)
                .toLowerCase()
                .includes(search.toLowerCase()),
          )
          .map((s) => (
            <GateRow
              key={s.id}
              label={s.name}
              detail={[
                s.partnerName,
                s.unitPrice !== null
                  ? (s.currency ?? "USD") + " " + s.unitPrice
                  : c("Rate not set", "Tarifa sin configurar"),
                s.unit?.replaceAll("_", " "),
              ]
                .filter(Boolean)
                .join(" · ")}
              onPress={() => {
                setEditing({ ...s });
                setReason("");
                setError("");
                setNotice("");
              }}
            />
          ))}
        {query.isSuccess &&
          !query.data.items.some(
            (s) =>
              s.selected && /gate/i.test(s.name + " " + (s.category ?? "")),
          ) && (
            <Text style={gateStyle.muted}>
              {c(
                "No selected company services. Authorize the company’s Gate service catalog before billing.",
                "No hay servicios seleccionados. Autoriza el catálogo de acceso de la empresa antes de facturar.",
              )}
            </Text>
          )}
      </GateCard>
      {editing && (
        <GateCard
          title={editing.name}
          subtitle={editing.partnerName}
          icon="edit-2"
        >
          <GateField
            label={c("Rate", "Tarifa")}
            keyboardType="decimal-pad"
            value={editing.unitPrice ?? ""}
            onChangeText={(v) => setEditing({ ...editing, unitPrice: v })}
          />
          <Text style={gateStyle.muted}>{c("Unit", "Unidad")}</Text>
          <View style={gateStyle.columns}>
            {["per_hour", "per_day", "per_job", "lump_sum"].map((unit) => (
              <TogglePillButton
                key={unit}
                compactOnTablet
                solid={editing.unit === unit}
                onPress={() => setEditing({ ...editing, unit })}
              >
                {unit.replaceAll("_", " ")}
              </TogglePillButton>
            ))}
          </View>
          <GateField
            label={c("Notes", "Notas")}
            multiline
            maxLength={500}
            value={editing.notes ?? ""}
            onChangeText={(v) => setEditing({ ...editing, notes: v })}
          />
          <GateField
            label={c("Reason for price change", "Motivo del cambio de precio")}
            maxLength={500}
            value={reason}
            onChangeText={setReason}
          />
          <TogglePillButton
            disabled={busy}
            loading={busy}
            onPress={() => void save()}
          >
            {c("Save this service rate", "Guardar esta tarifa")}
          </TogglePillButton>
          <TogglePillButton disabled={busy} onPress={() => setEditing(null)}>
            {c("Cancel", "Cancelar")}
          </TogglePillButton>
        </GateCard>
      )}
    </GatePage>
  );
}
