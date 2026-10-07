import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Crypto from "expo-crypto";
import { useTranslation } from "react-i18next";
import {
  FleetRunSchema,
  FleetAvailabilityReadSchema,
  FleetAvailabilityInputSchema,
  fleetAvailabilityLocalWindow,
  fleetAvailabilityFingerprintValues,
  submitFleetAvailabilityAttempt,
  FleetAvailabilityAbsentConflict,
  type FleetAvailabilityAttempt,
  type FleetAvailability,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import TogglePillButton from "@/components/TogglePillButton";
import { apiFetch } from "@/lib/api";
import {
  captureAuthScope,
  isAuthScopeCurrent,
  subscribeToken,
  subscribeUser,
  getUser,
} from "@/lib/auth";

type Selection = { value: Date; dateChosen: boolean; timeChosen: boolean };
export default function FleetDriverAvailability({
  driverUserId,
  actorUserId,
  companyId,
  runId,
}: {
  driverUserId: number;
  actorUserId: number;
  companyId: number;
  runId?: string;
}) {
  const { t } = useTranslation();
  const identity = `${actorUserId}:${companyId}:${driverUserId}:${runId}`,
    context = useRef(identity),
    alive = useRef(true),
    sequence = useRef(0),
    busyRef = useRef(false);
  context.current = identity;
  const [data, setData] = useState<z.infer<
      typeof FleetAvailabilityReadSchema
    > | null>(null),
    [attempt, setAttempt] = useState<FleetAvailabilityAttempt | null>(null);
  const [observation, setObservation] = useState<FleetAvailability | null>(
    null,
  );
  const [start, setStart] = useState<Selection | null>(null),
    [end, setEnd] = useState<Selection | null>(null),
    [available, setAvailable] = useState(true),
    [recordId, setRecordId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [picker, setPicker] = useState<{
      field: "start" | "end";
      mode: "date" | "time";
    } | null>(null);
  useEffect(() => {
    alive.current = true;
    const clear = () => {
      sequence.current++;
      setData(null);
      setObservation(null);
      setAttempt(null);
      setStart(null);
      setEnd(null);
      setRecordId(null);
      setStatus("");
      setPicker(null);
      busyRef.current = false;
      setBusy(false);
    };
    clear();
    const a = subscribeToken(clear),
      b = subscribeUser(clear);
    return () => {
      alive.current = false;
      sequence.current++;
      a();
      b();
    };
  }, [identity]);
  function current(
    key: string,
    n: number,
    scope: ReturnType<typeof captureAuthScope>,
  ) {
    return (
      alive.current &&
      context.current === key &&
      sequence.current === n &&
      isAuthScopeCurrent(scope)
    );
  }
  async function load() {
    if (busyRef.current || attempt) return;
    const key = identity,
      n = ++sequence.current,
      scope = captureAuthScope();
    busyRef.current = true;
    setBusy(true);
    setData(null);
    setObservation(null);
    try {
      const user = await getUser();
      if (!current(key, n, scope) || user?.id !== actorUserId)
        throw new Error("context_changed");
      const value = FleetAvailabilityReadSchema.parse(
        await apiFetch(
          `/api/fleet/drivers/${driverUserId}/availability`,
          {},
          scope,
        ),
      );
      if (!current(key, n, scope) || value.driverUserId !== driverUserId)
        throw new Error("context_changed");
      let checked: FleetAvailability | null = null;
      if (runId) {
        const run = FleetRunSchema.parse(
          await apiFetch(`/api/fleet/runs/${runId}`, {}, scope),
        );
        if (
          !current(key, n, scope) ||
          run.id !== runId ||
          run.companyId !== companyId ||
          run.driverUserId !== driverUserId ||
          !run.availability
        )
          throw new Error("wrong_run");
        checked = run.availability;
      }
      setObservation(checked);
      setData(value);
      setStatus("");
    } catch {
      if (current(key, n, scope)) setStatus("unavailable");
    } finally {
      if (current(key, n, scope)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  function local(value: Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}T${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  }
  async function review() {
    if (
      busyRef.current ||
      attempt ||
      !data?.canManage ||
      !start?.dateChosen ||
      !start.timeChosen ||
      !end?.dateChosen ||
      !end.timeChosen
    ) {
      if (!attempt) setStatus("invalidTime");
      return;
    }
    const key = identity,
      n = sequence.current,
      scope = captureAuthScope();
    busyRef.current = true;
    setBusy(true);
    try {
      const body = FleetAvailabilityInputSchema.parse({
        operationId: Crypto.randomUUID(),
        driverUserId,
        recordId,
        expectedFingerprint: data.fingerprint,
        window: fleetAvailabilityLocalWindow(
          local(start.value),
          local(end.value),
        ),
        available,
      });
      const commandFingerprint = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        JSON.stringify(
          fleetAvailabilityFingerprintValues(actorUserId, companyId, body),
        ),
      );
      if (!current(key, n, scope)) return;
      setAttempt({ actorUserId, companyId, body, commandFingerprint });
      setStatus("");
    } catch {
      if (current(key, n, scope)) setStatus("invalidTime");
    } finally {
      if (current(key, n, scope)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  async function confirm() {
    if (busyRef.current || !attempt) return;
    const held = attempt,
      key = identity,
      n = sequence.current,
      scope = captureAuthScope();
    busyRef.current = true;
    setBusy(true);
    try {
      const user = await getUser();
      if (!current(key, n, scope) || user?.id !== actorUserId)
        throw new Error("context_changed");
      await submitFleetAvailabilityAttempt(held, {
        assertCurrent: () => {
          if (!current(key, n, scope)) throw new Error("context_changed");
        },
        request: (method, path, body) =>
          apiFetch(
            path,
            {
              method,
              ...(body
                ? {
                    body: JSON.stringify(body),
                    headers: { "Content-Type": "application/json" },
                  }
                : {}),
            },
            scope,
          ),
      });
      if (!current(key, n, scope)) return;
      setAttempt(null);
      setData(null);
      setObservation(null);
      setRecordId(null);
      setStatus("saved");
    } catch (error) {
      if (current(key, n, scope))
        setStatus(
          error instanceof FleetAvailabilityAbsentConflict
            ? "conflict"
            : "unknown",
        );
    } finally {
      if (current(key, n, scope)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  const locked = busy || !!attempt;
  const messages: Record<string, string> = {
    unavailable: t("fleetAvailability.unavailable"),
    saved: t("fleetAvailability.saved"),
    unknown: t("fleetAvailability.unknown"),
    conflict: t("fleetAvailability.conflict"),
    invalidTime: t("fleetAvailability.invalidTime"),
  };
  const labels = {
    start: t("fleetAvailability.start"),
    end: t("fleetAvailability.end"),
    date: t("fleetAvailability.date"),
    time: t("fleetAvailability.time"),
  };
  const states = {
    not_requested: t("fleetAvailability.not_requested"),
    recorded_available: t("fleetAvailability.recorded_available"),
    recorded_unavailable: t("fleetAvailability.recorded_unavailable"),
    recorded_conflict: t("fleetAvailability.recorded_conflict"),
    unknown_no_window: t("fleetAvailability.unknown_no_window"),
    unknown_recurrence: t("fleetAvailability.unknown_recurrence"),
  };
  return (
    <View style={{ gap: 8 }}>
      <TogglePillButton disabled={locked} onPress={() => void load()}>
        {t("fleetAvailability.read")}
      </TogglePillButton>
      <Text>{t("fleetAvailability.boundary")}</Text>
      {status ? (
        <Text accessibilityRole="alert">{messages[status]}</Text>
      ) : null}
      {observation && (
        <Text>
          {states[observation.state]}
          {observation.window
            ? ` · ${new Date(observation.window.plannedStartAt).toLocaleString(undefined, { timeZone: observation.window.timezone })} → ${new Date(observation.window.plannedEndAt).toLocaleString(undefined, { timeZone: observation.window.timezone })} · ${observation.window.timezone}`
            : ""}
        </Text>
      )}
      {data && (
        <>
          {data.records.map((record) => (
            <View key={record.id}>
              <Text>
                {new Date(record.startsAt).toLocaleString()} →{" "}
                {new Date(record.endsAt).toLocaleString()} ·{" "}
                {t(
                  record.available
                    ? "fleetAvailability.available"
                    : "fleetAvailability.unavailableRecord",
                )}
                {record.recurring
                  ? ` · ${t("fleetAvailability.recurring")}`
                  : ""}
              </Text>
              {data.canManage && !record.recurring && (
                <TogglePillButton
                  disabled={locked}
                  onPress={() => {
                    setRecordId(record.id);
                    setStart({
                      value: new Date(record.startsAt),
                      dateChosen: true,
                      timeChosen: true,
                    });
                    setEnd({
                      value: new Date(record.endsAt),
                      dateChosen: true,
                      timeChosen: true,
                    });
                    setAvailable(record.available);
                  }}
                >
                  {t("fleetAvailability.edit")}
                </TogglePillButton>
              )}
            </View>
          ))}
          {!data.records.length && (
            <Text>{t("fleetAvailability.noRecords")}</Text>
          )}
          {data.canManage && (
            <>
              <TogglePillButton
                disabled={locked}
                onPress={() => {
                  setRecordId(null);
                  setStart(null);
                  setEnd(null);
                }}
              >
                {t("fleetAvailability.new")}
              </TogglePillButton>
              {(["start", "end"] as const).map((field) => (
                <View key={field}>
                  <Text>
                    {labels[field]}:{" "}
                    {(field === "start"
                      ? start
                      : end
                    )?.value.toLocaleString() ??
                      t("fleetAvailability.notSelected")}
                  </Text>
                  {(["date", "time"] as const).map((mode) => (
                    <TogglePillButton
                      key={mode}
                      disabled={locked}
                      onPress={() => setPicker({ field, mode })}
                    >
                      {labels[field]} · {labels[mode]}
                    </TogglePillButton>
                  ))}
                </View>
              ))}
              <Text>
                {t("fleetAvailability.timezone")}:{" "}
                {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </Text>
              <TogglePillButton
                disabled={locked}
                solid={available}
                onPress={() => setAvailable(!available)}
              >
                {t(
                  available
                    ? "fleetAvailability.available"
                    : "fleetAvailability.unavailableRecord",
                )}
              </TogglePillButton>
              {!attempt && (
                <TogglePillButton disabled={busy} onPress={() => void review()}>
                  {t("fleetAvailability.review")}
                </TogglePillButton>
              )}
            </>
          )}
        </>
      )}
      {picker && !locked && (
        <DateTimePicker
          value={(picker.field === "start" ? start : end)?.value ?? new Date()}
          mode={picker.mode}
          onChange={(event, value) => {
            const chosen = picker;
            setPicker(null);
            if (event.type !== "set" || !value) return;
            const update = (previous: Selection | null) => ({
              value,
              dateChosen:
                chosen.mode === "date" || previous?.dateChosen === true,
              timeChosen:
                chosen.mode === "time" || previous?.timeChosen === true,
            });
            (chosen.field === "start" ? setStart : setEnd)(update);
          }}
        />
      )}
      {attempt && (
        <>
          <Text>
            {new Date(attempt.body.window.plannedStartAt).toLocaleString(
              undefined,
              { timeZone: attempt.body.window.timezone },
            )}{" "}
            →{" "}
            {new Date(attempt.body.window.plannedEndAt).toLocaleString(
              undefined,
              { timeZone: attempt.body.window.timezone },
            )}{" "}
            · {attempt.body.window.timezone} ·{" "}
            {t(
              attempt.body.available
                ? "fleetAvailability.available"
                : "fleetAvailability.unavailableRecord",
            )}
          </Text>
          <TogglePillButton
            disabled={busy || status === "conflict"}
            onPress={() => void confirm()}
          >
            {t(
              status === "unknown"
                ? "fleetAvailability.check"
                : "fleetAvailability.confirm",
            )}
          </TogglePillButton>
          {status === "conflict" && (
            <TogglePillButton
              disabled={busy}
              onPress={() => {
                setAttempt(null);
                setData(null);
                setStatus("");
              }}
            >
              {t("fleetAvailability.reviewCurrent")}
            </TogglePillButton>
          )}
        </>
      )}
    </View>
  );
}
