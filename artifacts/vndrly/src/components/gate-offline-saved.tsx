import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { visitsApi } from "@/lib/visits-api";
import {
  gateOfflineMayHold,
  listGateOfflineEntries,
  retryGateOfflineEntry,
  uploadGateOfflineEntries,
  type GateOfflineEntry,
  type GateOfflineUser,
} from "@/lib/gate-offline-store";

const CHANGED = "vndrly:gate-offline-changed";

/** The check-ins and check-outs still on this computer, kept current as they are saved and uploaded. */
export function useGateOfflineEntries(user: GateOfflineUser | null | undefined) {
  const [entries, setEntries] = useState<GateOfflineEntry[]>([]);
  const identity = user ? `${user.userId}:${user.activeMembershipId}:${user.vendorId}:${user.partnerId}` : "";
  useEffect(() => {
    if (!user) { setEntries([]); return; }
    let current = true;
    const load = () => {
      if (!gateOfflineMayHold(user)) { setEntries([]); return; }
      void listGateOfflineEntries(user).then((rows) => { if (current) setEntries(rows); }).catch(() => undefined);
    };
    load();
    window.addEventListener(CHANGED, load);
    return () => { current = false; window.removeEventListener(CHANGED, load); };
  }, [identity]);
  return entries;
}

/**
 * Uploads what the Gate saved with no connection, from any page, as soon as the server answers a signed-in person.
 * Each record goes up under its own operation id and counts only when the server returns that same record.
 */
export function GateOfflineUploader() {
  const { user } = useAuth();
  const cache = useQueryClient();
  const running = useRef(false);
  const identity = user && !user.offlineOnly ? `${user.userId}:${user.activeMembershipId}:${user.vendorId}:${user.partnerId}` : "";
  useEffect(() => {
    if (!user || !identity) return;
    let current = true;
    const pass = async () => {
      if (running.current || !current || !gateOfflineMayHold(user)) return;
      running.current = true;
      let uploaded = false;
      try {
        await uploadGateOfflineEntries(user, async (entry) => {
          const saved = await visitsApi.uploadGateOfflineEntry(
            { ...entry.payload, operationId: entry.operationId, observedAt: entry.capturedAt, source: "gatekeeper" },
            AbortSignal.timeout(20_000),
          );
          if (!Number.isInteger(saved?.id) || saved.reconciliationFacts?.operationId?.value !== entry.operationId)
            throw new Error("The server did not confirm this record.");
          uploaded = true;
        });
      } catch {
        // The storage could not be read this time; the next pass tries again.
      } finally {
        running.current = false;
      }
      if (uploaded && current)
        for (const key of ["gatekeeper-visits", "gatekeeper-recent-visits", "gatekeeper-departures"])
          void cache.invalidateQueries({ queryKey: [key] });
    };
    const trigger = () => void pass();
    trigger();
    const timer = window.setInterval(trigger, 15_000);
    window.addEventListener("online", trigger);
    window.addEventListener(CHANGED, trigger);
    return () => {
      current = false;
      window.clearInterval(timer);
      window.removeEventListener("online", trigger);
      window.removeEventListener(CHANGED, trigger);
    };
  }, [identity]);
  return null;
}

/** The Gate's list of what is saved on this computer and has not reached the server. */
export function GateOfflineSaved({ user, entries, disabled, storageWarning, onCheckOut }: {
  user: GateOfflineUser;
  entries: GateOfflineEntry[];
  disabled: boolean;
  /** The browser would not promise to keep its storage. */
  storageWarning: boolean;
  /** Checks out a visitor whose check-in is itself still on this computer. */
  onCheckOut: (entry: GateOfflineEntry) => void;
}) {
  const { t } = useTranslation();
  const shown = entries.filter((entry) => entry.state !== "synced");
  if (!shown.length) return null;
  const checkedOut = new Set(entries.map((entry) => entry.payload.entryOperationId));
  return (
    <section className="rounded-md border border-amber-500/60 bg-amber-500/10 p-3 text-sm text-foreground" data-testid="gate-offline-saved">
      <p role="status" className="font-semibold">{t("gatekeeper.savedOnDeviceTitle")} ({shown.length})</p>
      <p className="text-muted-foreground">{t("gatekeeper.savedOnDeviceBody")}</p>
      {storageWarning && <p role="alert" className="mt-1 font-medium">{t("gatekeeper.offlineStorageWarning")}</p>}
      <ul className="mt-2 space-y-1">
        {shown.map((entry) => (
          <li key={entry.operationId} className="flex flex-wrap items-center gap-2" data-testid="gate-offline-entry" data-state={entry.state}>
            <span className="font-medium">
              {entry.payload.direction === "entry" ? t("gatekeeper.offlineCheckIn") : t("gatekeeper.offlineCheckOut")} · {entry.label}
            </span>
            <span className="text-muted-foreground">
              {new Date(entry.capturedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {entry.state === "pending" ? t("gatekeeper.offlineWaiting")
                : entry.state === "conflict" ? t("gatekeeper.offlineConflict")
                : entry.state === "revoked" ? t("gatekeeper.offlineRevoked")
                : t("gatekeeper.offlineFailed")}{entry.reason ? `: ${entry.reason}` : ""}
            </span>
            {(entry.state === "revoked" || entry.state === "failed") && (
              <button type="button" className="gate-history-filter" onClick={() => void retryGateOfflineEntry(user, entry.operationId)}>
                {t("gatekeeper.offlineRetry")}
              </button>
            )}
            {entry.payload.direction === "entry" && entry.state === "pending" && !checkedOut.has(entry.operationId) && (
              <button type="button" className="vendor-mini-card-button" disabled={disabled} onClick={() => onCheckOut(entry)}>
                {t("gatekeeper.checkOut")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
