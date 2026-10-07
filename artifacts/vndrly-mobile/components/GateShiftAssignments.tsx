import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as Crypto from "expo-crypto";
import {
  GateShiftStaffingCandidatesSchema,
  type GateShiftStaffingCandidates,
} from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api";
import {
  captureAuthScope,
  isAuthScopeCurrent,
  subscribeUser,
  subscribeToken,
} from "@/lib/auth";
import TogglePillButton from "@/components/TogglePillButton";
import {
  assignableGateCandidate,
  prepareGateAssignment,
  submitGateAssignment,
  GateAssignmentChanged,
  type GateAssignmentAttempt,
} from "@/lib/gate-shift-assignment";

const configurationKeys = {
  unknown: "gateShiftAssignment.unknown",
  none_configured: "gateShiftAssignment.none_configured",
  configured: "gateShiftAssignment.configured",
} as const;
const availabilityKeys = {
  recorded_conflict: "gateShiftAssignment.availability_recorded_conflict",
  unknown_recurrence: "gateShiftAssignment.availability_unknown_recurrence",
  recorded_available: "gateShiftAssignment.availability_recorded_available",
  unknown_no_window: "gateShiftAssignment.availability_unknown_no_window",
} as const;
const qualificationKeys = {
  recorded_requirements_verified:
    "gateShiftAssignment.qualification_recorded_requirements_verified",
  missing_or_unverified:
    "gateShiftAssignment.qualification_missing_or_unverified",
  unknown_no_configured_requirements:
    "gateShiftAssignment.qualification_unknown_no_configured_requirements",
} as const;
export default function GateShiftAssignments({
  shiftId,
  onSaved,
  onPendingChange,
}: {
  shiftId: string;
  onSaved?: () => Promise<unknown>;
  onPendingChange?: (pending: boolean) => void;
}) {
  const { user } = useAuth();
  const key = [
    shiftId,
    user?.id,
    user?.activeMembershipId,
    user?.vendorId,
    captureAuthScope().generation,
  ].join(":");
  return (
    <Assignments
      key={key}
      shiftId={shiftId}
      onSaved={onSaved}
      onPendingChange={onPendingChange}
    />
  );
}
function Assignments({
  shiftId,
  onSaved,
  onPendingChange,
}: {
  shiftId: string;
  onSaved?: () => Promise<unknown>;
  onPendingChange?: (pending: boolean) => void;
}) {
  const { user } = useAuth(),
    { t } = useTranslation();
  const scope = useRef(captureAuthScope()),
    mounted = useRef(true),
    busy = useRef(false),
    loadSequence = useRef(0);
  const [snapshot, setSnapshot] = useState<GateShiftStaffingCandidates | null>(
      null,
    ),
    [selected, setSelected] = useState<number[]>([]),
    [attempt, setAttempt] = useState<GateAssignmentAttempt | null>(null),
    [reviewed, setReviewed] = useState(false),
    [sending, setSending] = useState(false),
    [notice, setNotice] = useState(""),
    [definitivelyChanged, setDefinitivelyChanged] = useState(false);
  const current = () => mounted.current && isAuthScopeCurrent(scope.current);
  const request = (path: string, init?: { method: string; body: string }) =>
    apiFetch(path, init, scope.current);
  async function load(saved = false) {
    const sequence = ++loadSequence.current;
    setSnapshot(null);
    setSelected([]);
    try {
      const raw = await request(
        `/api/work-hub/shifts/${shiftId}/staffing-candidates`,
      );
      if (!current()) return;
      const s = GateShiftStaffingCandidatesSchema.parse(raw);
      if (s.shiftId !== shiftId) throw Error("shift_mismatch");
      setSnapshot(s);
    } catch {
      if (current() && sequence === loadSequence.current)
        setNotice(
          t(
            saved
              ? "gateShiftAssignment.savedRefresh"
              : "gateShiftAssignment.unavailable",
          ),
        );
    }
  }
  useEffect(() => {
    mounted.current = true;
    const clear = () => {
      if (!current()) {
        setSnapshot(null);
        setAttempt(null);
        setSelected([]);
        setNotice("");
        onPendingChange?.(false);
      }
    };
    const a = subscribeUser(clear),
      b = subscribeToken(clear);
    void load();
    return () => {
      mounted.current = false;
      a();
      b();
    };
  }, []);
  async function review() {
    if (!snapshot || !user?.vendorId || !current() || busy.current) return;
    busy.current = true;
    setSending(true);
    try {
      const a = await prepareGateAssignment(
        snapshot,
        selected,
        crypto.randomUUID(),
        user.id,
        user.vendorId,
        (text) =>
          Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text),
      );
      if (!current()) return;
      setAttempt(a);
      setReviewed(true);
      setNotice("");
      onPendingChange?.(true);
    } catch {
      if (current()) setNotice(t("gateShiftAssignment.reviewFailed"));
    } finally {
      busy.current = false;
      if (current()) setSending(false);
    }
  }
  async function save() {
    if (!attempt || !current() || busy.current) return;
    busy.current = true;
    setSending(true);
    setReviewed(false);
    setDefinitivelyChanged(false);
    try {
      await submitGateAssignment(attempt, request, current);
      if (!current()) return;
      setAttempt(null);
      onPendingChange?.(false);
      setNotice(t("gateShiftAssignment.saved"));
      await load(true);
      try {
        await onSaved?.();
      } catch {
        if (current()) setNotice(t("gateShiftAssignment.savedRefresh"));
      }
    } catch (e) {
      if (current()) {
        setDefinitivelyChanged(e instanceof GateAssignmentChanged);
        setNotice(
          t(
            e instanceof GateAssignmentChanged
              ? "gateShiftAssignment.changed"
              : "gateShiftAssignment.resultUnknown",
          ),
        );
      }
    } finally {
      busy.current = false;
      if (current()) setSending(false);
    }
  }
  return (
    <View style={{ gap: 10 }}>
      <Text>{t("gateShiftAssignment.title")}</Text>
      <Text>{t("gateShiftAssignment.boundary")}</Text>
      {!attempt && snapshot && (
        <>
          <Text>
            {new Date(snapshot.startsAt).toLocaleString()} →{" "}
            {new Date(snapshot.endsAt).toLocaleString()}
          </Text>
          <Text>
            {t(configurationKeys[snapshot.qualificationConfiguration])}
          </Text>
          <Text>{t("gateShiftAssignment.availabilityHelp")}</Text>
          {snapshot.candidates.map((c) => (
            <View key={c.userId}>
              <TogglePillButton
                disabled={!assignableGateCandidate(snapshot, c) || sending}
                onPress={() =>
                  setSelected((v) =>
                    v.includes(c.userId)
                      ? v.filter((id) => id !== c.userId)
                      : [...v, c.userId],
                  )
                }
              >
                {(selected.includes(c.userId) ? "✓ " : "") + c.name}
              </TogglePillButton>
              <Text>
                {t(availabilityKeys[c.availability])} ·{" "}
                {t(qualificationKeys[c.qualificationState])}
              </Text>
              {c.requirements.map((r) => (
                <Text key={r.code}>
                  {r.code}:{" "}
                  {t(
                    r.currentRecorded && r.vendorVerified
                      ? "gateShiftAssignment.verified"
                      : "gateShiftAssignment.notVerified",
                  )}
                </Text>
              ))}
            </View>
          ))}
          {snapshot.truncated && (
            <Text>{t("gateShiftAssignment.truncated")}</Text>
          )}
          <TogglePillButton
            disabled={!selected.length || sending}
            onPress={() => void review()}
          >
            {t("gateShiftAssignment.review")}
          </TogglePillButton>
        </>
      )}
      {attempt && (
        <>
          <Text>
            {new Date(attempt.startsAt).toLocaleString(undefined, {
              timeZone: attempt.timezone,
            })}{" "}
            →{" "}
            {new Date(attempt.endsAt).toLocaleString(undefined, {
              timeZone: attempt.timezone,
            })}{" "}
            · {attempt.timezone}
            {"\n"}
            {attempt.names.join(", ")} ·{" "}
            {t("gateShiftAssignment.version", {
              version: attempt.input.expectedVersion,
            })}
          </Text>
          <TogglePillButton
            disabled={sending || definitivelyChanged}
            onPress={() => void save()}
          >
            {t(
              reviewed
                ? "gateShiftAssignment.save"
                : "gateShiftAssignment.check",
            )}
          </TogglePillButton>
          {(reviewed || definitivelyChanged) && (
            <TogglePillButton
              disabled={sending}
              onPress={() => {
                setAttempt(null);
                setReviewed(false);
                setDefinitivelyChanged(false);
                onPendingChange?.(false);
                void load();
              }}
            >
              {t("gateShiftAssignment.edit")}
            </TogglePillButton>
          )}
        </>
      )}
      {!attempt && (
        <TogglePillButton disabled={sending} onPress={() => void load()}>
          {t("gateShiftAssignment.refresh")}
        </TogglePillButton>
      )}
      <Text accessibilityLiveRegion="polite">{notice}</Text>
    </View>
  );
}
