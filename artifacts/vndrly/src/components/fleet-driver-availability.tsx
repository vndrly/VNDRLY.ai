import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { PngPillButton } from "@/components/png-pill-rollover";
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

export function FleetDriverAvailability({
  driverUserId,
  runId,
}: {
  driverUserId: number;
  runId?: string;
}) {
  const { user } = useAuth(),
    { t } = useTranslation();
  const membershipRole = user?.availableMemberships?.find(
    (membership) => membership.id === user.activeMembershipId,
  )?.role;
  const identity = `${user?.userId}:${user?.activeMembershipId}:${user?.vendorId}:${user?.role}:${membershipRole}:${user?.vendorRole}:${user?.vendorPeopleId}:${driverUserId}:${runId}`;
  const context = useRef(identity),
    alive = useRef(true),
    busyRef = useRef(false),
    sequence = useRef(0);
  context.current = identity;
  const [data, setData] = useState<z.infer<
    typeof FleetAvailabilityReadSchema
  > | null>(null);
  const [observation, setObservation] = useState<FleetAvailability | null>(
    null,
  );
  const [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [available, setAvailable] = useState(true),
    [recordId, setRecordId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<FleetAvailabilityAttempt | null>(null),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  useEffect(() => {
    alive.current = true;
    sequence.current++;
    setData(null);
    setObservation(null);
    setAttempt(null);
    setStatus("");
    setStart("");
    setEnd("");
    setRecordId(null);
    busyRef.current = false;
    setBusy(false);
    return () => {
      alive.current = false;
      sequence.current++;
    };
  }, [identity]);
  function fence(key: string, seq: number) {
    if (!alive.current || context.current !== key || sequence.current !== seq)
      throw new Error("context_changed");
  }
  async function request(method: "GET" | "POST", path: string, body?: unknown) {
    const response = await fetch(path, {
      method,
      credentials: "include",
      cache: "no-store",
      ...(body
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
    if (!response.ok) throw new Error("request_refused");
    return response.json();
  }
  async function load() {
    if (busyRef.current || attempt) return;
    const key = identity,
      seq = ++sequence.current;
    busyRef.current = true;
    setBusy(true);
    setData(null);
    setObservation(null);
    try {
      const value = FleetAvailabilityReadSchema.parse(
        await request("GET", `/api/fleet/drivers/${driverUserId}/availability`),
      );
      fence(key, seq);
      if (value.driverUserId !== driverUserId) throw new Error("wrong_driver");
      let checked: FleetAvailability | null = null;
      if (runId) {
        const run = FleetRunSchema.parse(
          await request("GET", `/api/fleet/runs/${runId}`),
        );
        fence(key, seq);
        if (
          run.id !== runId ||
          run.driverUserId !== driverUserId ||
          run.companyId !== user?.vendorId ||
          !run.availability
        )
          throw new Error("wrong_run");
        checked = run.availability;
      }
      setObservation(checked);
      setData(value);
      setStatus("");
    } catch {
      if (alive.current && context.current === key && sequence.current === seq)
        setStatus("unavailable");
    } finally {
      if (
        alive.current &&
        context.current === key &&
        sequence.current === seq
      ) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  async function review() {
    if (
      busyRef.current ||
      attempt ||
      !data?.canManage ||
      !user?.userId ||
      !user.vendorId
    )
      return;
    const key = identity,
      seq = sequence.current;
    busyRef.current = true;
    setBusy(true);
    try {
      const body = FleetAvailabilityInputSchema.parse({
        operationId: crypto.randomUUID(),
        driverUserId,
        recordId,
        expectedFingerprint: data.fingerprint,
        window: fleetAvailabilityLocalWindow(start, end),
        available,
      });
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          JSON.stringify(
            fleetAvailabilityFingerprintValues(
              user.userId,
              user.vendorId,
              body,
            ),
          ),
        ),
      );
      fence(key, seq);
      setAttempt({
        actorUserId: user.userId,
        companyId: user.vendorId,
        body,
        commandFingerprint: Array.from(new Uint8Array(hash), (value) =>
          value.toString(16).padStart(2, "0"),
        ).join(""),
      });
      setStatus("");
    } catch {
      if (alive.current && context.current === key && sequence.current === seq)
        setStatus("invalidTime");
    } finally {
      if (
        alive.current &&
        context.current === key &&
        sequence.current === seq
      ) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  async function confirm() {
    if (busyRef.current || !attempt) return;
    const held = attempt,
      key = identity,
      seq = sequence.current;
    busyRef.current = true;
    setBusy(true);
    try {
      await submitFleetAvailabilityAttempt(held, {
        request,
        assertCurrent: () => fence(key, seq),
      });
      fence(key, seq);
      setAttempt(null);
      setData(null);
      setObservation(null);
      setRecordId(null);
      setStatus("saved");
    } catch (error) {
      if (alive.current && context.current === key && sequence.current === seq)
        setStatus(
          error instanceof FleetAvailabilityAbsentConflict
            ? "conflict"
            : "unknown",
        );
    } finally {
      if (
        alive.current &&
        context.current === key &&
        sequence.current === seq
      ) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  const local = (value: string) => {
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  };
  const messages: Record<string, string> = {
    unavailable: t("fleetAvailability.unavailable"),
    saved: t("fleetAvailability.saved"),
    unknown: t("fleetAvailability.unknown"),
    conflict: t("fleetAvailability.conflict"),
    invalidTime: t("fleetAvailability.invalidTime"),
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
    <section className="space-y-2">
      <PngPillButton
        color="blue"
        disabled={busy || !!attempt}
        onClick={() => void load()}
      >
        {t("fleetAvailability.read")}
      </PngPillButton>
      <p>{t("fleetAvailability.boundary")}</p>
      {status && <p role="status">{messages[status]}</p>}
      {observation && (
        <p>
          {states[observation.state]}
          {observation.window
            ? ` · ${new Date(observation.window.plannedStartAt).toLocaleString(undefined, { timeZone: observation.window.timezone })} → ${new Date(observation.window.plannedEndAt).toLocaleString(undefined, { timeZone: observation.window.timezone })} · ${observation.window.timezone}`
            : ""}
        </p>
      )}
      {data && (
        <>
          {data.records.map((record) => (
            <div key={record.id}>
              <p>
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
              </p>
              {data.canManage && !record.recurring && (
                <PngPillButton
                  color="blue"
                  disabled={busy || !!attempt}
                  onClick={() => {
                    setRecordId(record.id);
                    setStart(local(record.startsAt));
                    setEnd(local(record.endsAt));
                    setAvailable(record.available);
                  }}
                >
                  {t("fleetAvailability.edit")}
                </PngPillButton>
              )}
            </div>
          ))}
          {!data.records.length && <p>{t("fleetAvailability.noRecords")}</p>}
          {data.canManage && (
            <>
              <PngPillButton
                color="blue"
                disabled={busy || !!attempt}
                onClick={() => {
                  setRecordId(null);
                  setStart("");
                  setEnd("");
                }}
              >
                {t("fleetAvailability.new")}
              </PngPillButton>
              <label>
                {t("fleetAvailability.start")} · {t("fleetAvailability.date")} ·{" "}
                {t("fleetAvailability.time")}
                <input
                  type="datetime-local"
                  disabled={busy || !!attempt}
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </label>
              <label>
                {t("fleetAvailability.end")} · {t("fleetAvailability.date")} ·{" "}
                {t("fleetAvailability.time")}
                <input
                  type="datetime-local"
                  disabled={busy || !!attempt}
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </label>
              {(!start || !end) && <p>{t("fleetAvailability.notSelected")}</p>}
              <p>
                {t("fleetAvailability.timezone")}:{" "}
                {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </p>
              <label>
                <input
                  type="checkbox"
                  disabled={busy || !!attempt}
                  checked={available}
                  onChange={(event) => setAvailable(event.target.checked)}
                />
                {t("fleetAvailability.available")}
              </label>
              {!attempt && (
                <PngPillButton
                  color="blue"
                  disabled={busy}
                  onClick={() => void review()}
                >
                  {t("fleetAvailability.review")}
                </PngPillButton>
              )}
            </>
          )}
        </>
      )}
      {attempt && (
        <>
          <p>
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
          </p>
          <PngPillButton
            color="blue"
            disabled={busy || status === "conflict"}
            onClick={() => void confirm()}
          >
            {t(
              status === "unknown"
                ? "fleetAvailability.check"
                : "fleetAvailability.confirm",
            )}
          </PngPillButton>
          {status === "conflict" && (
            <PngPillButton
              color="blue"
              disabled={busy}
              onClick={() => {
                setAttempt(null);
                setData(null);
                setStatus("");
              }}
            >
              {t("fleetAvailability.reviewCurrent")}
            </PngPillButton>
          )}
        </>
      )}
    </section>
  );
}
