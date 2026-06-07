import { useEffect, useMemo, useState } from "react";
import type { FieldEmployee } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type FieldCoWorker = {
  id: number;
  userId: number | null;
  firstName: string;
  lastName: string;
  vendorRole?: string | null;
  jobTitle?: string | null;
};

/**
 * Foreman-portal roster — field employees cannot call GET /field-employees
 * (vendor/admin only). Uses GET /api/field/co-workers instead.
 */
export function useFieldCoWorkers(enabled: boolean): {
  coworkers: FieldCoWorker[];
  eligibleForemen: FieldEmployee[];
  rosterLoaded: boolean;
} {
  const [coworkers, setCoworkers] = useState<FieldCoWorker[]>([]);
  const [rosterLoaded, setRosterLoaded] = useState(!enabled);

  useEffect(() => {
    if (!enabled) {
      setCoworkers([]);
      setRosterLoaded(true);
      return;
    }
    let cancelled = false;
    setRosterLoaded(false);
    fetch(`${BASE}/api/field/co-workers`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (cancelled) return;
        setCoworkers(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setCoworkers([]);
      })
      .finally(() => {
        if (!cancelled) setRosterLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const eligibleForemen = useMemo(
    (): FieldEmployee[] =>
      coworkers.map((c) => ({
        id: c.id,
        vendorId: 0,
        firstName: c.firstName,
        lastName: c.lastName,
        isActive: true,
        userId: c.userId,
      })) as FieldEmployee[],
    [coworkers],
  );

  return { coworkers, eligibleForemen, rosterLoaded };
}
