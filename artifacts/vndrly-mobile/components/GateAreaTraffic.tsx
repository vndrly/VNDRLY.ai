import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import * as Crypto from "expo-crypto";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { useGateOperatingContext } from "@/hooks/use-gate-operating-context";
import {
  readGateAreaTraffic,
  recordGateMovement,
  type GateMovementCommand,
  parallelGateGroup,
} from "@/lib/gate-traffic";
import { gatekeeperCheckOut } from "@/lib/gatekeeper";
import { changeOverRequest } from "@/lib/change-over-api";
import type { AreaVisit } from "@workspace/gate-booth";
import DismissibleModal from "./DismissibleModal";
import { ModalPressable as Pressable } from "./ModalDraft";
import TogglePillButton from "./TogglePillButton";
/** Native interaction adapter. Destination is intent; only a confirmed enter changes presence. */
export default function GateAreaTraffic({
  siteId,
  gateId,
  history = false,
}: {
  siteId: number | null;
  gateId?: string;
  history?: boolean;
}) {
  const { user, activeMembershipId } = useAuth(),
    { t, i18n } = useTranslation(),
    colors = useColors(),
    cache = useQueryClient(),
    operating = useGateOperatingContext();
  const query = useQuery({
    queryKey: ["gate-area-traffic", user?.id, activeMembershipId, siteId,gateId],
    queryFn: () => readGateAreaTraffic(siteId!,gateId),
    enabled: !!siteId,
    refetchInterval: 15000,
    retry: false,
  });
  const [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [destinations, setDestinations] = useState<Record<number, string>>({});
  const [showAll, setShowAll] = useState(false);
  const [correction, setCorrection] = useState<{ visit: AreaVisit; mode: "edit" | "undo-checkout" } | null>(null);
  const [details, setDetails] = useState({ firstName: "", lastName: "", company: "", vehiclePlate: "", plateState: "" });
  const [correctionBusy, setCorrectionBusy] = useState(false);
  const [correctionError, setCorrectionError] = useState("");
  const correctionLock = useRef(false);
  const correctionOperation = useRef<{ key: string; id: string } | null>(null);
  const c = (en: string, es: string) => i18n?.language?.startsWith("es") ? es : en;
  const timeLabel = (value: string) => new Date(value).toLocaleString(i18n?.language?.startsWith("es") ? "es-US" : "en-US");
  const lock = useRef(false),
    operation = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    setPage(0);
    setDestinations({});
    setMessage("");
    setShowAll(false);
    setCorrection(null);
  }, [siteId, gateId, activeMembershipId]);
  const gates = query.data?.gates ?? [],
    gate = gates.find((row) => row.id === gateId),
    area = gate?.topology?.area;
  const allowed =
    !busy &&
    !query.isError &&
    operating.canOperate(siteId ?? undefined, gateId) &&
    !!gateId &&
    !!query.data?.movementGateIds.includes(gateId);
  const siblings = parallelGateGroup(gates, gateId);
  const ordinaryRows = (query.data?.visits ?? []).filter(
    (v) =>
      !v.checkOutTime &&
      (area || !v.entryGateId || siblings.has(v.entryGateId)),
  );
  const rows = !history ? ordinaryRows : (query.data?.visits ?? []).filter(v => {
    if (!gate) return false;
    if (!area && v.entryGateId && !gates.some(item => item.siteId !== gate.siteId)) {
      let anchor = v.entryGateId;
      const seen = new Set<string>();
      while (!seen.has(anchor)) {
        seen.add(anchor);
        const upstream = gates.find(item => item.id === anchor)?.topology?.parentGateId;
        if (!upstream) break;
        anchor = upstream;
      }
      if (!siblings.has(anchor)) return false;
    }
    if (showAll) return !v.checkOutTime;
    return !area || gates.find(item => item.id === v.presence.currentGateId)?.topology?.area === area || v.movements.some(m => m.area === area);
  });
  const last = Math.max(0, Math.ceil(rows.length / 25) - 1),
    current = Math.min(page, last);
  const inArea = (id: string | null) =>
    !!area && gates.find((g) => g.id === id)?.topology?.area === area;
  async function act(visitId: number, kind: GateMovementCommand["kind"] | "site_exit") {
    if (lock.current || !allowed || !siteId || !gateId) return;
    const destination =
      destinations[visitId] ?? (kind === "leave" ? "site_exit" : "remain");
    const parent =
      gates.find((g) => g.id === gate?.topology?.parentGateId) ?? gate;
    const named = parent?.topology?.destinations ?? [];
    const body = {
      siteId,
      gateId,
      visitId,
      kind,
      ...(kind === "enter"
        ? {}
        : destination === "site_exit" || destination === "remain"
          ? { destination }
          : named.some((d) => d.id === destination)
            ? { destinationId: destination }
            : { destinationGateId: destination }),
    } as Omit<GateMovementCommand, "operationId">;
    const key = JSON.stringify(body);
    if (operation.current?.key !== key)
      operation.current = { key, id: Crypto.randomUUID() };
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (kind === "site_exit") await gatekeeperCheckOut(visitId, undefined, { gateStationId: gateId });
      else await recordGateMovement({ ...body, operationId: operation.current.id } as GateMovementCommand);
      operation.current = null;
      setMessage(t("gateMovement.saved"));
      await Promise.all(
        [
          "gate-area-traffic",
          "gatekeeper-visits",
          "gatekeeper-departures",
          "gate-history-report",
          "gate-coverage-map",
        ].map((key) => cache.invalidateQueries({ queryKey: [key] })),
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t("gateMovement.failed"),
      );
      await query.refetch();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function openCorrection(visit: AreaVisit, mode: "edit" | "undo-checkout") {
    setCorrection({ visit, mode });
    setDetails({ firstName: visit.firstName, lastName: visit.lastName, company: visit.company ?? "", vehiclePlate: visit.vehiclePlate ?? "", plateState: visit.plateState ?? "" });
    setCorrectionError("");
  }
  async function saveCorrection() {
    if (!correction || !siteId || !gateId || !allowed || correctionLock.current || correctionBusy) return;
    if (correction.mode === "edit" && (!details.firstName.trim() || !details.lastName.trim())) { setCorrectionError(c("First and last name are required.", "El nombre y apellido son obligatorios.")); return; }
    const body = { siteId, gateId, visitId: correction.visit.id, action: correction.mode, ...(correction.mode === "edit" ? { details } : { expectedCheckoutAt: correction.visit.checkOutTime }) };
    const key = JSON.stringify(body);
    if (correctionOperation.current?.key !== key) correctionOperation.current = { key, id: Crypto.randomUUID() };
    correctionLock.current = true;
    setCorrectionBusy(true);
    setCorrectionError("");
    try {
      await changeOverRequest("/visit-corrections", { ...body, operationId: correctionOperation.current.id });
      correctionOperation.current = null;
      setCorrection(null);
      await Promise.all(["gate-area-traffic", "gatekeeper-visits", "gatekeeper-departures", "gatekeeper-recent-visits", "gate-history-report", "gate-coverage-map"].map(key => cache.invalidateQueries({ queryKey: [key] })));
    } catch (error) {
      setCorrectionError(error instanceof Error ? error.message : c("Could not save the correction.", "No se pudo guardar la corrección."));
    } finally { correctionLock.current = false; setCorrectionBusy(false); }
  }
  if (!siteId) return null;
  if (history && query.isLoading) return <Text accessibilityRole="text" style={{ color: "#aaa" }}>{c("Loading site movements…", "Cargando movimientos…")}</Text>;
  if (query.isError)
    return (
      <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={{ color: colors.foreground }}>{history ? c("Site movements could not be refreshed. Presence is unknown until refreshed.", "No se pudieron actualizar los movimientos. La presencia es desconocida hasta actualizar.") : t("gateMovement.failed")}</Text>{history && <TogglePillButton onPress={() => void query.refetch()}>{c("Retry", "Reintentar")}</TogglePillButton>}</View>
    );
  if (
    !gate ||
    !gates.some((g) => g.topology?.area || g.topology?.destinations?.length)
  )
    return null;
  const parent =
    gates.find((g) => g.id === gate.topology?.parentGateId) ?? gate;
  const options = (
    parent.topology?.destinations?.length
      ? parent.topology.destinations.map((d) => ({
          id: d.id,
          name: d.name,
          gateId: d.gateId,
        }))
      : gates
          .filter((g) => g.active && g.topology?.area)
          .map((g) => ({ id: g.id, name: g.name, gateId: g.id }))
  ).filter(
    (d) =>
      !area || gates.find((g) => g.id === d.gateId)?.topology?.area !== area,
  );
  if (history) return <View style={{ gap: 12 }}>
    <Text style={{ color: "#f4f4f4", fontSize: 14, fontWeight: "600" }}>{c("Site and secure-area movements", "Movimientos del sitio y áreas seguras")}</Text>
    {!!area && <Pressable accessibilityRole="button" accessibilityState={{ selected: showAll }} onPress={() => setShowAll(value => !value)}><Text style={{ color: colors.primary, fontSize: 14 }}>{showAll ? c("Show this gate’s queue", "Mostrar lista de este acceso") : c("Find someone already on site / unexpected arrival", "Buscar persona en el sitio / llegada no prevista")}</Text></Pressable>}
    {!!message && <Text accessibilityRole="alert" style={{ color: "#f4f4f4", fontSize: 14 }}>{message}</Text>}
    {!allowed && <Text style={{ color: "#f4f4f4", fontSize: 14 }}>{c("View only — you cannot record movements at this gate.", "Solo lectura — no puede registrar movimientos en este acceso.")}</Text>}
    {!rows.length && <Text style={{ color: "#aaa", fontSize: 14 }}>{c("No internal movements in this queue.", "No hay movimientos internos en esta lista.")}</Text>}
    {rows.map(v => {
      const isInner = !!area;
      const isIn = inArea(v.presence.currentGateId);
      const canEnter = isInner && !isIn && (v.presence.expectedGateId === gateId || showAll);
      const canLeave = isInner && (isIn || showAll && !gates.find(item => item.id === v.presence.currentGateId)?.topology?.area);
      const canRoute = false;
      const hours = v.checkInTime ? Math.max(0, (Date.now() - Date.parse(v.checkInTime)) / 3_600_000) : 0;
      return <View key={v.id} style={{ borderWidth: 1, borderColor: "#4a4a4a", borderRadius: 8, backgroundColor: "#27272a", padding: 12, gap: 8 }}>
        <Text style={{ color: "#f4f4f4", fontWeight: "700", fontSize: 14 }}>{v.firstName} {v.lastName}</Text>
        <Text style={{ color: "#d8d8d8", fontSize: 14 }}>{[v.company, v.vehiclePlate].filter(Boolean).join(" · ")}</Text>
        <Text style={{ color: "#d8d8d8", fontSize: 14 }}>{v.presence.label}</Text>
        {!v.checkOutTime && <View style={{ gap: 8 }}>
          {canEnter && <TogglePillButton disabled={!allowed} onPress={() => void act(v.id, "enter")}>{c("Confirm arrival", "Confirmar llegada")}</TogglePillButton>}
          {(canLeave || canRoute) && <>
            <Text style={{ color: "#d8d8d8", fontSize: 14 }}>{c("Next destination", "Próximo destino")}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {(isInner ? [{ id: "site_exit", name: c("Leaving site", "Salir del sitio") }, { id: "remain", name: c("Remaining on site", "Permanecer en el sitio") }, ...options] : [{ id: "remain", name: c("Remaining on site", "Permanecer en el sitio") }, ...options]).map(option => <TogglePillButton key={option.id} disabled={!allowed} onPress={() => setDestinations(current => ({ ...current, [v.id]: option.id }))}>{(destinations[v.id] ?? (isInner ? "site_exit" : "remain")) === option.id ? "✓ " : ""}{option.name}</TogglePillButton>)}
            </View>
            <TogglePillButton disabled={!allowed} onPress={() => void act(v.id, isInner ? "leave" : "route")}>{isInner ? c("Check out", "Registrar salida") : c("Set destination", "Establecer destino")}</TogglePillButton>
          </>}
          {!isInner && <TogglePillButton disabled={!allowed} onPress={() => void act(v.id, "site_exit")}>{c("Check out", "Registrar salida")}</TogglePillButton>}
        </View>}
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}><TogglePillButton disabled={!allowed} onPress={() => openCorrection(v, "edit")}>{c("Edit", "Editar")}</TogglePillButton>{!isInner && !!v.checkOutTime && v.movements.some(m => m.kind === "site_exit") && <TogglePillButton disabled={!allowed} onPress={() => openCorrection(v, "undo-checkout")}>{c("Undo check-out", "Revertir salida")}</TogglePillButton>}</View>
        <Text style={{ color: "#d8d8d8", fontSize: 13, fontWeight: "600" }}>{c("Movement history", "Historial de movimientos")} ({v.movements.length})</Text>
        {v.movements.map(m => <Text key={m.operationId} style={{ color: "#aaa", fontSize: 12 }}>{timeLabel(m.at)} · {m.gateName} · {m.actorName ?? (m.actorId ? `User ${m.actorId}` : c("Gatekeeper", "Portero"))} · {m.kind === "enter" ? c("Entered", "Entrada") : m.kind === "leave" ? c("Left area", "Salida del área") : m.kind === "route" ? c("Destination updated", "Destino actualizado") : m.kind === "edit" ? c("Edited", "Editado") : m.kind === "undo_site_exit" ? c("Checkout undone", "Salida revertida") : c("Left site", "Salida del sitio")}{m.note ? ` · ${m.note}` : ""}{m.destination !== "remain" ? ` → ${m.destination === "site_exit" ? c("Main Gate", "Acceso principal") : m.destination}` : ""}</Text>)}
        {!!v.checkInTime && <Text style={{ color: "#aaa", fontSize: 12 }}>{c("Time on site", "Tiempo en el sitio")}: {Math.floor(hours)}:{String(Math.floor(hours * 60) % 60).padStart(2, "0")}</Text>}
      </View>;
    })}
    <DismissibleModal visible={!!correction} transparent animationType="fade" onRequestClose={() => { if (!correctionBusy) setCorrection(null); }} dismissLabel="close"><View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "center", padding: 16 }}><View style={{ borderWidth: 2, borderColor: colors.primary, borderRadius: 12, backgroundColor: "#242426", padding: 18, gap: 10 }}>
      <Text style={{ color: "white", fontSize: 18, fontWeight: "700" }}>{correction?.mode === "edit" ? c("Edit visit", "Editar visita") : c("Undo check-out", "Revertir salida")}</Text>
      <Text style={{ color: "#aaa" }}>{correction?.mode === "edit" ? c("Correct the saved driver and vehicle details.", "Corrija los datos del conductor y del vehículo.") : c("Restore this driver to On Site.", "Devuelva a este conductor a En sitio.")}</Text>
      {correction?.mode === "edit" && (Object.keys(details) as (keyof typeof details)[]).map(key => <View key={key} style={{ gap: 4 }}><Text style={{ color: "#ddd" }}>{({ firstName: c("First name", "Nombre"), lastName: c("Last name", "Apellido"), company: c("Company", "Empresa"), vehiclePlate: c("Tag", "Placa"), plateState: c("Issuing state", "Estado emisor") })[key]}</Text><TextInput value={details[key]} onChangeText={value => setDetails(current => ({ ...current, [key]: value }))} editable={!correctionBusy} style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 6, padding: 9, color: "white" }} /></View>)}
      {!!correctionError && <Text accessibilityRole="alert" style={{ color: "#f87171" }}>{correctionError}</Text>}
      <View style={{ flexDirection: "row", gap: 8 }}><TogglePillButton disabled={correctionBusy} onPress={() => setCorrection(null)}>{c("Cancel", "Cancelar")}</TogglePillButton><TogglePillButton disabled={correctionBusy || !allowed} onPress={() => void saveCorrection()}>{correction?.mode === "edit" ? c("Save", "Guardar") : c("Restore to On Site", "Restaurar a En sitio")}</TogglePillButton></View>
    </View></View></DismissibleModal>
  </View>;
  return (
    <View
      style={{
        gap: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: colors.primary,
      }}
    >
      <Text style={{ color: colors.foreground, fontWeight: "700" }}>
        {t("gateMovement.title")}
      </Text>
      {!allowed && (
        <Text style={{ color: colors.foreground }}>
          {t("gateOperating.readOnly")}
        </Text>
      )}
      {!!message && (
        <Text accessibilityRole="alert" style={{ color: colors.foreground }}>
          {message}
        </Text>
      )}
      {rows.slice(current * 25, (current + 1) * 25).map((v) => (
        <View key={v.id} style={{ gap: 6 }}>
          <Text style={{ color: colors.foreground }}>
            {v.firstName} {v.lastName} · {v.vehiclePlate}
          </Text>
          <Text style={{ color: colors.foreground }}>{v.presence.label}</Text>
          {area && !inArea(v.presence.currentGateId) && (
            <TogglePillButton
              disabled={!allowed}
              onPress={() => void act(v.id, "enter")}
            >
              {t("gateMovement.enter")}
            </TogglePillButton>
          )}
          {(inArea(v.presence.currentGateId) ||
            (!area &&
              !gates.find((g) => g.id === v.presence.currentGateId)?.topology
                ?.area)) && (
            <>
              <Text style={{ color: colors.foreground }}>
                {t("gateMovement.destination")}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {[
                  { id: "remain", name: t("gateMovement.remain") },
                  ...(area
                    ? [{ id: "site_exit", name: t("gateMovement.exit") }]
                    : []),
                  ...options,
                ].map((d) => (
                  <TogglePillButton
                    key={d.id}
                    disabled={!allowed}
                    onPress={() =>
                      setDestinations((p) => ({ ...p, [v.id]: d.id }))
                    }
                  >
                    {(destinations[v.id] ?? (area ? "site_exit" : "remain")) ===
                    d.id
                      ? "✓ "
                      : ""}
                    {d.name}
                  </TogglePillButton>
                ))}
              </View>
              <TogglePillButton
                disabled={!allowed}
                onPress={() => void act(v.id, area ? "leave" : "route")}
              >
                {t(area ? "gateMovement.leave" : "gateMovement.route")}
              </TogglePillButton>
            </>
          )}
        </View>
      ))}
      {!rows.length && (
        <Text style={{ color: colors.foreground }}>
          {t("gateMovement.empty")}
        </Text>
      )}
      {rows.length > 25 && (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TogglePillButton
            disabled={current === 0}
            onPress={() => setPage(current - 1)}
          >
            {t("common.previous")}
          </TogglePillButton>
          <Text style={{ color: colors.foreground }}>
            {current + 1}/{last + 1}
          </Text>
          <TogglePillButton
            disabled={current === last}
            onPress={() => setPage(current + 1)}
          >
            {t("common.next")}
          </TogglePillButton>
        </View>
      )}
    </View>
  );
}
