import React, { useState, useRef } from "react";
import { Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { GateField, GateError, gateStyle, useGateCopy } from "./GateChrome";
import TogglePillButton from "@/components/TogglePillButton";
import {
  gateShiftClock,
  prepareGateShiftChange,
  verifyGateShiftChange,
  type EditableGateShift,
} from "@/lib/gate-shift-change";
export default function GateShiftEditor({
  shift,
  onSaved,
}: {
  shift: EditableGateShift;
  onSaved(value: EditableGateShift): void;
}) {
  const c = useGateCopy(),
    [editing, setEditing] = useState(false),
    [title, setTitle] = useState(shift.title),
    [start, setStart] = useState(
      gateShiftClock(shift.startsAt, shift.timezone),
    ),
    [end, setEnd] = useState(gateShiftClock(shift.endsAt, shift.timezone)),
    [review, setReview] = useState<ReturnType<
      typeof prepareGateShiftChange
    > | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  function prepare(action: "cancel" | "reschedule") {
    try {
      setError("");
      setReview(
        prepareGateShiftChange(
          shift,
          action === "cancel"
            ? { action }
            : {
                action,
                title,
                startDate: start.date,
                startTime: start.time,
                endDate: end.date,
                endTime: end.time,
              },
          randomUUID(),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function save() {
    if (!review || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const scope = captureAuthScope();
    try {
      const receipt = await apiFetch<{ operationId: string }>(
        "/api/work-hub/shifts/" + shift.id,
        { method: "PATCH", body: JSON.stringify(review) },
        scope,
      );
      if (receipt.operationId !== review.operationId)
        throw Error("The operation receipt could not be verified.");
      const read = await apiFetch<{ item: EditableGateShift }>(
        "/api/work-hub/calendar/items/shift/" + shift.id,
        {},
        scope,
      );
      const saved = verifyGateShiftChange(read.item, shift, review);
      if (isAuthScopeCurrent(scope)) {
        setReview(null);
        setEditing(false);
        onSaved(saved);
      }
    } catch (e) {
      if (isAuthScopeCurrent(scope))
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      lock.current = false;
      if (isAuthScopeCurrent(scope)) setBusy(false);
    }
  }
  return (
    <View style={{ gap: 10 }}>
      <GateError message={error} />
      {review ? (
        <>
          <Text style={gateStyle.text}>
            {review.payload.action === "cancel"
              ? c(
                  "Cancel this scheduled shift?",
                  "¿Cancelar este turno programado?",
                )
              : title +
                " · " +
                start.date +
                " " +
                start.time +
                " → " +
                end.date +
                " " +
                end.time +
                " · " +
                shift.timezone}
          </Text>
          <Text style={gateStyle.muted}>
            {c(
              "This changes the saved schedule. Active watches and recorded attendance are retained.",
              "Esto cambia el horario guardado. Se conservan las guardias activas y la asistencia registrada.",
            )}
          </Text>
          <TogglePillButton disabled={busy} onPress={() => void save()}>
            {c("Confirm schedule change", "Confirmar cambio de horario")}
          </TogglePillButton>
          <TogglePillButton disabled={busy} onPress={() => setReview(null)}>
            {c("Back to shift", "Volver al turno")}
          </TogglePillButton>
        </>
      ) : editing ? (
        <>
          <GateField
            label={c("Shift title", "Título del turno")}
            value={title}
            onChangeText={setTitle}
          />
          <GateField
            label={c("Start date", "Fecha de inicio")}
            value={start.date}
            onChangeText={(date) => setStart({ ...start, date })}
          />
          <GateField
            label={c("Start time", "Hora de inicio")}
            value={start.time}
            onChangeText={(time) => setStart({ ...start, time })}
          />
          <GateField
            label={c("End date", "Fecha de fin")}
            value={end.date}
            onChangeText={(date) => setEnd({ ...end, date })}
          />
          <GateField
            label={c("End time", "Hora de fin")}
            value={end.time}
            onChangeText={(time) => setEnd({ ...end, time })}
          />
          <Text style={gateStyle.muted}>{shift.timezone}</Text>
          <TogglePillButton onPress={() => prepare("reschedule")}>
            {c("Review schedule change", "Revisar cambio de horario")}
          </TogglePillButton>
          <TogglePillButton onPress={() => setEditing(false)}>
            {c("Cancel edit", "Cancelar edición")}
          </TogglePillButton>
        </>
      ) : (
        <>
          <TogglePillButton onPress={() => setEditing(true)}>
            {c("Edit scheduled shift", "Editar turno programado")}
          </TogglePillButton>
          <TogglePillButton onPress={() => prepare("cancel")}>
            {c("Cancel scheduled shift", "Cancelar turno programado")}
          </TogglePillButton>
        </>
      )}
    </View>
  );
}
