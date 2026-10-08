import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { z } from "zod/v4";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import TogglePillButton from "./TogglePillButton";
import {
  WorkHubShiftOpeningInputSchema,
  validateWorkHubShiftOpeningAttempt,
  submitWorkHubShiftOpeningAttempt,
  workHubShiftOpeningFingerprintValues,
  type WorkHubShiftOpeningAttempt,
} from "@workspace/api-zod";
const shiftSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  ownerOrgType: z.enum(["vendor", "partner"]),
  ownerOrgId: z.number().int().positive(),
  version: z.number().int().positive(),
  open: z.boolean(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  timezone: z.string(),
  milestoneStatus: z.string(),
  assigneeUserIds: z.array(z.number().int().positive()),
  gateStationId: z.uuid().nullable(),
  siteLocationId: z.number().int().positive().nullable(),
});
type Choice = { id: string; title: string };
export default function WorkHubShiftOpening({
  shifts,
  onSaved,
}: {
  shifts: unknown[];
  onSaved?: () => Promise<unknown>;
}) {
  const { user } = useAuth();
  const active = user?.availableMemberships?.find(
    (m) => m.id === user.activeMembershipId,
  );
  const owner =
    user?.role === "partner" && user.partnerId
      ? { type: "partner" as const, id: user.partnerId }
      : user?.vendorId
        ? { type: "vendor" as const, id: user.vendorId }
        : null;
  if (
    !user ||
    !owner ||
    (active?.role !== "admin" && user.vendorRole !== "gate_supervisor")
  )
    return null;
  const scope = captureAuthScope(),
    identity = JSON.stringify([
      user.id,
      user.activeMembershipId,
      owner,
      user.vendorRole,
      active?.role,
    ]);
  const choices = shifts.flatMap((raw) => {
    const v = raw as { item?: Choice };
    return v.item &&
      typeof v.item.id === "string" &&
      typeof v.item.title === "string"
      ? [v.item]
      : [];
  });
  return (
    <Panel
      key={identity + scope.generation}
      identity={identity}
      actor={user.id}
      owner={owner}
      choices={choices}
      onSaved={onSaved}
    />
  );
}
function Panel({
  identity,
  actor,
  owner,
  choices,
  onSaved,
}: {
  identity: string;
  actor: number;
  owner: { type: "vendor" | "partner"; id: number };
  choices: Choice[];
  onSaved?: () => Promise<unknown>;
}) {
  const { i18n } = useTranslation(),
    es = i18n.language.startsWith("es"),
    scope = useRef(captureAuthScope()).current,
    alive = useRef(true),
    working = useRef(false),
    key = "work-hub-shift-opening:" + identity;
  const [pending, setPending] = useState<WorkHubShiftOpeningAttempt | null>(
      null,
    ),
    [review, setReview] = useState<{
      attempt: WorkHubShiftOpeningAttempt;
      title: string;
      startsAt: string;
      endsAt: string;
      timezone: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [blocked, setBlocked] = useState(false),
    [message, setMessage] = useState("");
  const current = () => alive.current && isAuthScopeCurrent(scope);
  const assertCurrent = () => {
    if (!current()) throw Error("account_changed");
  };
  const http = async (
    path: string,
    method: "GET" | "PATCH",
    body?: unknown,
  ) => {
    assertCurrent();
    const out = await apiFetch(
      "/api" + path,
      { method, ...(body ? { body: JSON.stringify(body) } : {}) },
      scope,
    );
    assertCurrent();
    return out;
  };
  const unknown = es
    ? "Resultado sin resolver. Consulte la misma solicitud antes de otra."
    : "Result unresolved. Check the same request before another.";
  useEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(key);
        assertCurrent();
        if (raw) {
          const p = JSON.parse(raw) as WorkHubShiftOpeningAttempt;
          WorkHubShiftOpeningInputSchema.parse(p.input);
          if (
            p.actorUserId !== actor ||
            p.owner.type !== owner.type ||
            p.owner.id !== owner.id ||
            !z.uuid().safeParse(p.shiftId).success ||
            !/^[a-f0-9]{64}$/.test(p.commandFingerprint)
          )
            throw Error("journal");
          await validateWorkHubShiftOpeningAttempt(p, (value) =>
            Crypto.digestStringAsync(
              Crypto.CryptoDigestAlgorithm.SHA256,
              value,
            ),
          );
          assertCurrent();
          setPending(p);
        }
        setReady(true);
      } catch {
        if (current()) {
          setBlocked(true);
          setMessage(unknown);
        }
      }
    })();
    return () => {
      alive.current = false;
    };
  }, []);
  async function prepare(id: string) {
    if (!ready || working.current || pending || blocked) return;
    working.current = true;
    setBusy(true);
    try {
      const raw = await http("/work-hub/calendar/items/shift/" + id, "GET");
      const s = shiftSchema.parse((raw as { item: unknown }).item);
      if (
        s.id !== id ||
        s.ownerOrgType !== owner.type ||
        s.ownerOrgId !== owner.id ||
        s.assigneeUserIds.length ||
        Date.parse(s.startsAt) <= Date.now() ||
        s.milestoneStatus !== "upcoming" ||
        Date.parse(s.endsAt) <= Date.parse(s.startsAt) ||
        (s.gateStationId && !s.siteLocationId)
      )
        throw Error("not_available");
      const input = WorkHubShiftOpeningInputSchema.parse({
        operationId: Crypto.randomUUID(),
        expectedVersion: s.version,
        open: !s.open,
      });
      const commandFingerprint = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        JSON.stringify(
          workHubShiftOpeningFingerprintValues(
            id,
            actor,
            owner.type,
            owner.id,
            input,
          ),
        ),
      );
      assertCurrent();
      setReview({
        attempt: {
          actorUserId: actor,
          shiftId: id,
          owner,
          context: s.gateStationId
            ? { kind: "gate", id: s.siteLocationId! }
            : { kind: "organization", id: owner.id },
          input,
          commandFingerprint,
        },
        title: s.title,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        timezone: s.timezone,
      });
      setMessage("");
    } catch {
      if (current())
        setMessage(
          es
            ? "No se puede cambiar este turno."
            : "This shift cannot be changed.",
        );
    } finally {
      working.current = false;
      if (current()) setBusy(false);
    }
  }
  async function save() {
    const a = pending ?? review?.attempt;
    if (!a || working.current) return;
    working.current = true;
    setBusy(true);
    let saved = false;
    try {
      await AsyncStorage.setItem(key, JSON.stringify(a));
      assertCurrent();
      setPending(a);
      setReview(null);
      await submitWorkHubShiftOpeningAttempt(a, http, (value) =>
        Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
      );
      assertCurrent();
      saved = true;
      setMessage(
        es
          ? "Ventana de solicitud guardada. No registra servicio ni presencia."
          : "Claim window saved. No duty or attendance recorded.",
      );
      await AsyncStorage.removeItem(key);
      assertCurrent();
      setPending(null);
      try {
        await onSaved?.();
        assertCurrent();
      } catch {
        if (current())
          setMessage(
            es
              ? "Guardado. Actualice para ver el turno."
              : "Saved. Refresh to view the shift.",
          );
      }
    } catch {
      if (current())
        setMessage(
          saved
            ? es
              ? "Guardado. Actualice para ver el turno."
              : "Saved. Refresh to view the shift."
            : unknown,
        );
    } finally {
      working.current = false;
      if (current()) setBusy(false);
    }
  }
  return (
    <View
      accessibilityLabel={
        es ? "Ventana de solicitud del turno" : "Shift claim window"
      }
    >
      <Text>
        {es
          ? "Abrir o cerrar solicitudes para turnos futuros sin asignar. No inicia servicio."
          : "Open or close claims for future unassigned shifts. This does not start duty."}
      </Text>
      {!pending &&
        !review &&
        choices.map((s) => (
          <TogglePillButton
            key={s.id}
            disabled={busy || blocked || !ready}
            onPress={() => void prepare(s.id)}
          >
            {s.title}
          </TogglePillButton>
        ))}
      {review && (
        <Text>
          {review.title} · {review.startsAt} — {review.endsAt} (
          {review.timezone}) · {es ? "Revisión" : "Version"}{" "}
          {review.attempt.input.expectedVersion} ·{" "}
          {review.attempt.input.open
            ? es
              ? "Abrir solicitudes"
              : "Open claims"
            : es
              ? "Cerrar solicitudes"
              : "Close claims"}
        </Text>
      )}
      {(pending || review) && (
        <TogglePillButton
          disabled={busy || blocked}
          onPress={() => void save()}
        >
          {pending
            ? es
              ? "Consultar la misma solicitud"
              : "Check the same request"
            : es
              ? "Guardar cambio revisado"
              : "Save reviewed change"}
        </TogglePillButton>
      )}
      {!!message && <Text accessibilityRole="alert">{message}</Text>}
    </View>
  );
}
