import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import TogglePillButton from "@/components/TogglePillButton";
import { apiFetch } from "@/lib/api";
import {
  captureAuthScope,
  isAuthScopeCurrent,
  subscribeUser,
  subscribeToken,
  getUser,
} from "@/lib/auth";
import {
  WorkHubAvailabilityInputSchema,
  WorkHubAvailabilityReadSchema,
  WorkHubAvailabilityAbsentConflict,
  submitWorkHubAvailabilityAttempt,
  workHubAvailabilityFingerprintValues,
  fleetAvailabilityLocalWindow,
  type WorkHubAvailabilityAttempt,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
const copy = {
  en: {
    title: "My work availability",
    planning: "Saved planning only. No duty or physical readiness is verified.",
    refresh: "Refresh",
    start: "Start local time: YYYY-MM-DDTHH:mm",
    end: "End local time: YYYY-MM-DDTHH:mm",
    available: "Available",
    unavailable: "Unavailable",
    new: "New interval",
    review: "Review availability",
    save: "Save reviewed interval",
    retry: "Check the same request",
    unknown:
      "Result unresolved. Check the same request before creating another.",
    saved: "Availability saved.",
    savedRefresh: "Saved. Refresh to view current records.",
    changed: "The snapshot changed. Refresh and review a new request.",
    error: "Availability could not be loaded.",
  },
  es: {
    title: "Mi disponibilidad laboral",
    planning:
      "Solo planificación guardada. No verifica servicio ni presencia física.",
    refresh: "Actualizar",
    start: "Inicio local: YYYY-MM-DDTHH:mm",
    end: "Fin local: YYYY-MM-DDTHH:mm",
    available: "Disponible",
    unavailable: "No disponible",
    new: "Nuevo intervalo",
    review: "Revisar disponibilidad",
    save: "Guardar intervalo revisado",
    retry: "Consultar la misma solicitud",
    unknown:
      "Resultado sin resolver. Consulte la misma solicitud antes de crear otra.",
    saved: "Disponibilidad guardada.",
    savedRefresh: "Guardado. Actualice para ver los registros.",
    changed: "La información cambió. Actualice y revise una nueva solicitud.",
    error: "No se pudo cargar la disponibilidad.",
  },
};
export default function WorkHubAvailability() {
  const { user } = useAuth();
  if (user?.role !== "field_employee" || !user.vendorId || !user.vendorPeopleId)
    return null;
  const identity = JSON.stringify([
    user.id,
    user.vendorId,
    user.activeMembershipId,
    user.role,
    user.vendorPeopleId,
  ]);
  return (
    <Panel
      key={identity}
      identity={identity}
      userId={user.id}
      companyId={user.vendorId}
    />
  );
}
function Panel({
  identity,
  userId,
  companyId,
}: {
  identity: string;
  userId: number;
  companyId: number;
}) {
  const { i18n } = useTranslation(),
    c = copy[i18n.language.startsWith("es") ? "es" : "en"];
  const scope = useRef(captureAuthScope()),
    alive = useRef(true),
    busyRef = useRef(false),
    key = `vndrly-own-availability:${identity}`;
  const [snapshot, setSnapshot] = useState<z.infer<
      typeof WorkHubAvailabilityReadSchema
    > | null>(null),
    [recordId, setRecordId] = useState<string | null>(null),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [available, setAvailable] = useState(true),
    [review, setReview] = useState<WorkHubAvailabilityAttempt | null>(null),
    [attempt, setAttempt] = useState<WorkHubAvailabilityAttempt | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [journalBlocked, setJournalBlocked] = useState(false);
  const current = () => alive.current && isAuthScopeCurrent(scope.current),
    assertCurrent = () => {
      if (!current()) throw Error("account_changed");
    };
  async function request(method: "GET" | "POST", path: string, body?: unknown) {
    assertCurrent();
    const out = await apiFetch(
      path,
      { method, ...(body ? { body: JSON.stringify(body) } : {}) },
      scope.current,
    );
    assertCurrent();
    return out;
  }
  async function refresh() {
    const nextScope = captureAuthScope();
    const nextUser = await getUser();
    if (
      !isAuthScopeCurrent(nextScope) ||
      !nextUser ||
      JSON.stringify([
        nextUser.id,
        nextUser.vendorId,
        nextUser.activeMembershipId,
        nextUser.role,
        nextUser.vendorPeopleId,
      ]) !== identity
    )
      return;
    scope.current = nextScope;
    alive.current = true;
    setReview(null);
    try {
      const raw = await AsyncStorage.getItem(key);
      assertCurrent();
      if (raw) {
        const pending = JSON.parse(raw) as WorkHubAvailabilityAttempt;
        WorkHubAvailabilityInputSchema.parse(pending.body);
        if (pending.userId !== userId || pending.companyId !== companyId)
          throw Error("journal_context");
        setAttempt(pending);
      }
      setJournalBlocked(false);
      await load();
    } catch {
      if (current()) {
        setJournalBlocked(true);
        setMessage(c.error);
      }
    }
  }
  async function load() {
    const data = WorkHubAvailabilityReadSchema.parse(
      await request("GET", "/api/work-hub/availability"),
    );
    assertCurrent();
    if (data.userId !== userId || data.companyId !== companyId)
      throw Error("account_changed");
    setSnapshot(data);
  }
  useEffect(() => {
    alive.current = true;
    scope.current = captureAuthScope();
    const invalidate = () => {
      alive.current = false;
      setSnapshot(null);
      setReview(null);
    };
    const unUser = subscribeUser(invalidate),
      unToken = subscribeToken(invalidate);
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(key);
        assertCurrent();
        if (raw) {
          const pending = JSON.parse(raw) as WorkHubAvailabilityAttempt;
          WorkHubAvailabilityInputSchema.parse(pending.body);
          if (pending.userId !== userId || pending.companyId !== companyId)
            throw Error("journal_context");
          setAttempt(pending);
        }
        await load();
      } catch {
        if (current()) {
          setJournalBlocked(true);
          setMessage(c.error);
        }
      }
    })();
    return () => {
      alive.current = false;
      unUser();
      unToken();
    };
  }, [identity]);
  async function prepare() {
    if (!snapshot || attempt || journalBlocked || busyRef.current) return;
    try {
      const body = WorkHubAvailabilityInputSchema.parse({
        operationId: Crypto.randomUUID(),
        recordId,
        expectedFingerprint: snapshot.fingerprint,
        window: fleetAvailabilityLocalWindow(start, end),
        available,
      });
      const commandFingerprint = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        JSON.stringify(
          workHubAvailabilityFingerprintValues(userId, companyId, body),
        ),
      );
      assertCurrent();
      setReview({
        userId,
        companyId,
        actorMembershipId: snapshot.actorMembershipId,
        actorSessionVersion: snapshot.actorSessionVersion,
        body,
        commandFingerprint,
      });
      setMessage("");
    } catch {
      if (current()) setMessage(c.error);
    }
  }
  async function save() {
    let verified = false;
    const pending = attempt ?? review;
    if (!pending || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await AsyncStorage.setItem(key, JSON.stringify(pending));
      assertCurrent();
      setAttempt(pending);
      setReview(null);
      await submitWorkHubAvailabilityAttempt(pending, {
        request,
        assertCurrent,
      });
      assertCurrent();
      verified = true;
      setMessage(c.saved);
      await AsyncStorage.removeItem(key);
      assertCurrent();
      setAttempt(null);
      setSnapshot(null);
      setRecordId(null);
      setMessage(c.saved);
      void load().catch(() => {
        if (current()) setMessage(c.savedRefresh);
      });
    } catch (error) {
      if (!current()) return;
      if (verified) {
        setSnapshot(null);
        setMessage(c.savedRefresh);
      } else if (error instanceof WorkHubAvailabilityAbsentConflict) {
        await AsyncStorage.removeItem(key);
        if (!current()) return;
        setAttempt(null);
        setSnapshot(null);
        setMessage(c.changed);
      } else setMessage(c.unknown);
    } finally {
      busyRef.current = false;
      if (current()) setBusy(false);
    }
  }
  const locked = Boolean(attempt || review || busy || journalBlocked);
  return (
    <View accessibilityLabel={c.title}>
      <Text>{c.title}</Text>
      <Text>{c.planning}</Text>
      <TogglePillButton disabled={busy} onPress={() => void refresh()}>
        {c.refresh}
      </TogglePillButton>
      {snapshot && (
        <>
          <TogglePillButton disabled={locked} onPress={() => setRecordId(null)}>
            {c.new}
          </TogglePillButton>
          {snapshot.records.map((r) => (
            <View key={r.id}>
              <Text>
                {r.startsAt} — {r.endsAt} ·{" "}
                {r.available ? c.available : c.unavailable}
              </Text>
              {!r.recurring && (
                <TogglePillButton
                  disabled={locked}
                  onPress={() => setRecordId(r.id)}
                >
                  {r.id === recordId ? "✓ " : ""}
                  {c.review}
                </TogglePillButton>
              )}
            </View>
          ))}
          <TextInput
            accessibilityLabel={c.start}
            placeholder={c.start}
            editable={!locked}
            value={start}
            onChangeText={setStart}
          />
          <TextInput
            accessibilityLabel={c.end}
            placeholder={c.end}
            editable={!locked}
            value={end}
            onChangeText={setEnd}
          />
          <TogglePillButton
            disabled={locked}
            onPress={() => setAvailable(!available)}
          >
            {available ? c.available : c.unavailable}
          </TogglePillButton>
          {!attempt && !review && (
            <TogglePillButton
              disabled={busy || journalBlocked || !snapshot.canManage}
              onPress={() => void prepare()}
            >
              {c.review}
            </TogglePillButton>
          )}
        </>
      )}
      {review && (
        <Text>
          {review.body.window.plannedStartAt} —{" "}
          {review.body.window.plannedEndAt} ({review.body.window.timezone}) ·{" "}
          {review.body.available ? c.available : c.unavailable}
        </Text>
      )}
      {(review || attempt) && (
        <TogglePillButton disabled={busy} onPress={() => void save()}>
          {attempt ? c.retry : c.save}
        </TogglePillButton>
      )}
      {!!message && <Text accessibilityRole="alert">{message}</Text>}
    </View>
  );
}
