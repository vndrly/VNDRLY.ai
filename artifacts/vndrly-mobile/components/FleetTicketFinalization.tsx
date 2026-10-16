import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { useFleetCopy } from "@/lib/fleet-copy";
type TicketRead = {
  ticketId: number;
  siteId: number;
  status: string;
  afeNumber: string;
  workDate: string;
  plan: { version: number } | null;
  runs: { id: string; title: string; status: string; version: number }[];
  canFinalize: boolean;
  finalizationOperationId: string | null;
};
/** Office finalization is separate from accepting an individual driver's run. */
export default function FleetTicketFinalization({
  ticketId,
  onChanged,
}: {
  ticketId: number;
  onChanged?: () => void;
}) {
  const colors = useColors(),
    copy = useFleetCopy(),
    scope = useRef(captureAuthScope()),
    alive = useRef(true),
    lock = useRef(false);
  const [data, setData] = useState<TicketRead | null>(null),
    [attempt, setAttempt] = useState<{
      operationId: string;
      expectedVersion: number;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [verified, setVerified] = useState(false);
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  async function read() {
    const value = await apiFetch<TicketRead>(
      `/api/fleet/tickets/${ticketId}/plan`,
      {},
      scope.current,
    );
    if (value.ticketId !== ticketId)
      throw Error("Ticket scope could not be verified.");
    return value;
  }
  useEffect(() => {
    alive.current = true;
    void read()
      .then((value) => {
        if (current()) setData(value);
      })
      .catch((e) => {
        if (current()) setError(e.message);
      });
    return () => {
      alive.current = false;
    };
  }, [ticketId]);
  async function submit() {
    if (!attempt || lock.current || !current()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const before = await read();
      if (!current()) return;
      if (before.finalizationOperationId !== attempt.operationId) {
        if (
          !before.canFinalize ||
          before.plan?.version !== attempt.expectedVersion
        ) {
          setData(before);
          setAttempt(null);
          setError(
            copy(
              "Ticket changed. Review the refreshed ticket before finalizing.",
            ),
          );
          return;
        }
        await apiFetch(
          `/api/fleet/tickets/${ticketId}/finalize`,
          { method: "POST", body: JSON.stringify(attempt) },
          scope.current,
        );
      }
      const saved = await read();
      if (!current()) return;
      if (
        saved.status !== "submitted" ||
        saved.finalizationOperationId !== attempt.operationId ||
        !saved.plan ||
        saved.plan.version <= attempt.expectedVersion
      )
        throw Error(
          "Ticket submission remains unverified. Check this same operation before retrying.",
        );
      setData(saved);
      setVerified(true);
      setAttempt(null);
      onChanged?.();
    } catch (e) {
      if (current()) {
        const status = (e as { status?: number }).status;
        if (status && status >= 400 && status < 500) {
          try {
            const fresh = await read();
            if (
              current() &&
              fresh.finalizationOperationId !== attempt.operationId
            ) {
              setData(fresh);
              setAttempt(null);
              setError(
                copy(
                  "Ticket changed. Review the refreshed ticket before finalizing.",
                ),
              );
              return;
            }
          } catch {
            /* Keep the same operation until readback establishes its outcome. */
          }
        }
        setError((e as Error).message);
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }
  return (
    <View style={{ gap: 8 }}>
      {data && (
        <>
          <Text style={{ color: colors.text }}>
            {copy("Ticket #")}
            {data.ticketId} · {copy("AFE")}: {data.afeNumber || "—"} ·{" "}
            {copy("Work date")}: {data.workDate} ·{" "}
            {copy(data.status.replaceAll("_", " "))}
          </Text>
          {(data.runs ?? []).map((run) => (
            <Text key={run.id} style={{ color: colors.text }}>
              {run.title} · {copy(run.status.replaceAll("_", " "))}
            </Text>
          ))}
          {!data.canFinalize && !verified && (
            <Text style={{ color: colors.text }}>
              {copy(
                "The ticket stays open until office staff review every noncancelled run and finalize the ticket.",
              )}
            </Text>
          )}
          {data.canFinalize && !attempt && (
            <TogglePillButton
              onPress={() => {
                if (data.plan)
                  setAttempt({
                    operationId: Crypto.randomUUID(),
                    expectedVersion: data.plan.version,
                  });
              }}
            >
              {copy("Review and finalize ticket")}
            </TogglePillButton>
          )}
          {attempt && (
            <>
              <Text style={{ color: colors.text }}>
                {copy(
                  "Finalize this ticket and submit its accepted run charges? This closes the ticket to new runs.",
                )}
              </Text>
              <TogglePillButton disabled={busy} onPress={() => void submit()}>
                {copy("Confirm finalization and submit ticket")}
              </TogglePillButton>
            </>
          )}
          {verified && (
            <Text style={{ color: colors.text }}>
              {copy("Ticket submission verified.")}
            </Text>
          )}
        </>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {error}
        </Text>
      )}
    </View>
  );
}
