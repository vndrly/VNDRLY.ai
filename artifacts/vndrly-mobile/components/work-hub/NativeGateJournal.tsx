import React, { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import TogglePillButton from "@/components/TogglePillButton";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { nativeUuid } from "@/lib/native-uuid";
import {
  enqueueNativeOperation,
  readNativeJournal,
} from "@/lib/native-operation-journal-runtime";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import type { JournalEntry } from "@/lib/native-operation-journal";
type Visitor = {
  firstName: string;
  lastName: string;
  company: string;
  purpose: string;
  notes: string;
  vehiclePlate: string;
  plateState: string | null;
};
export default function NativeGateJournal({
  siteId,
  visitor,
  onRecorded,
  refresh,
}: {
  siteId: number | null;
  visitor: Visitor;
  onRecorded(): void;
  /** Changes when the Gate form itself kept a check-in on this device. */
  refresh?: number;
}) {
  const { user } = useAuth(),
    { t } = useTranslation(),
    colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false),
    [entries, setEntries] = useState<JournalEntry[]>([]);
  useEffect(() => {
    setEntries([]);
    let alive = true;
    const scope = captureAuthScope();
    if (user)
      void readNativeJournal(user)
        .then((value) => {
          if (alive && isAuthScopeCurrent(scope))
            setEntries(value.filter((entry) => entry.domain === "gate"));
        })
        .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [user?.id, user?.activeMembershipId, busy, refresh]);
  async function record(direction: "entry" | "exit", entry?: JournalEntry) {
    if (
      !user ||
      !siteId ||
      busy ||
      (!entry &&
        (!visitor.vehiclePlate.trim() ||
          !visitor.firstName.trim() ||
          !visitor.lastName.trim()))
    )
      return;
    const scope = captureAuthScope();
    setBusy(true);
    try {
      const prior = entry?.payload as
        | { plate?: string; plateState?: string; siteLocationId: number; gateStationId?: string }
        | undefined;
      await enqueueNativeOperation(user, {
        operationId: nativeUuid(),
        domain: "gate",
        capturedAt: new Date().toISOString(),
        payload: {
          siteLocationId: prior?.siteLocationId ?? siteId,
          direction,
          // An exit carries the tag its own entry was saved with, which may be none.
          plate: entry ? prior?.plate : visitor.vehiclePlate.trim(),
          plateState: entry ? prior?.plateState : visitor.plateState ?? undefined,
          ...(entry
            ? // The gate its entry named, so an office person covering it is recognised when the record uploads.
              { entryOperationId: entry.operationId, gateStationId: prior?.gateStationId }
            : {
                reportedVisitor: {
                  firstName: visitor.firstName.trim(),
                  lastName: visitor.lastName.trim(),
                  company: visitor.company.trim(),
                  purpose: visitor.purpose.trim(),
                  notes: visitor.notes.trim(),
                },
              }),
        },
      });
      if (isAuthScopeCurrent(scope)) {
        onRecorded();
        Alert.alert(t("nativeJournal.title"), t("nativeJournal.gatePending"));
      }
    } catch {
      if (isAuthScopeCurrent(scope))
        Alert.alert(t("nativeJournal.title"), t("nativeJournal.unavailable"));
    } finally {
      if (isAuthScopeCurrent(scope)) setBusy(false);
    }
  }
  if (!user || !siteId) return null;
  return (
    <View style={{ gap: 10 }}>
      <TogglePillButton onPress={() => setExpanded(!expanded)}>
        {t("nativeJournal.offlineCapture", {
          defaultValue: "Offline Gate capture",
        })}
      </TogglePillButton>
      {expanded && (
        <View style={{ gap: 10 }}>
          <Text accessibilityRole="alert" style={{ color: colors.text }}>
            {t("nativeJournal.gateWarning")}
          </Text>
          <TogglePillButton
            disabled={
              busy ||
              !visitor.vehiclePlate.trim() ||
              !visitor.firstName.trim() ||
              !visitor.lastName.trim()
            }
            onPress={() => {
              void record("entry");
            }}
          >
            {t("nativeJournal.recordEntry")}
          </TogglePillButton>
        </View>
      )}
      {/* A visitor checked in on this device and not yet uploaded stays in view, so they can be checked out with no connection. */}
      {entries
        .filter(
          (entry) =>
            (expanded || entry.state !== "synced") &&
            (
              entry.payload as {
                direction?: string;
                siteLocationId?: number;
              }
            ).direction === "entry" &&
            (entry.payload as { siteLocationId?: number }).siteLocationId ===
              siteId &&
            !entries.some(
              (other) =>
                (other.payload as { entryOperationId?: string })
                  .entryOperationId === entry.operationId,
            ),
        )
        .map((entry) => {
          const saved = entry.payload as {
            plate?: string;
            reportedVisitor?: { firstName: string; lastName: string };
          };
          return (
            <TogglePillButton
              key={entry.operationId}
              disabled={busy}
              onPress={() => {
                void record("exit", entry);
              }}
            >
              {t("nativeJournal.recordExit", {
                plate: [
                  `${saved.reportedVisitor?.firstName ?? ""} ${saved.reportedVisitor?.lastName ?? ""}`.trim(),
                  saved.plate,
                ]
                  .filter(Boolean)
                  .join(" · "),
              })}
            </TogglePillButton>
          );
        })}
    </View>
  );
}
