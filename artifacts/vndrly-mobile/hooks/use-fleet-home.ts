import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import { FleetHomeProjectionSchema, type FleetHomeProjection } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import type { FleetHomeVisibility } from "@/components/fleet/FleetHome";

type HomeResult = { module: "summary"; state: "ready" | "empty" | "warning" | "unavailable"; data?: unknown; error?: { code: string } };
type Identity = { companyId: number; userId: number; membershipId: number };
const listeners = new Set<() => void>();
const visibilityKey = ({ companyId, userId, membershipId }: Identity) => `fleet-home-visibility:${companyId}:${userId}:${membershipId}`;

export async function readFleetHomeVisibility(identity: Identity): Promise<FleetHomeVisibility> {
  const raw = await AsyncStorage.getItem(visibilityKey(identity));
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(value).filter(([key, enabled]) => ["dispatch", "yard", "driver", "office", "assets", "runs", "map", "history", "locations", "compliance"].includes(key) && typeof enabled === "boolean")) as FleetHomeVisibility;
  } catch { return {}; }
}

export async function saveFleetHomeVisibility(identity: Identity, visibility: FleetHomeVisibility): Promise<void> {
  await AsyncStorage.setItem(visibilityKey(identity), JSON.stringify(visibility));
  listeners.forEach(listener => listener());
}

export function useFleetHome(enabled = true) {
  const { user, activeMembershipId, activeMembership } = useAuth();
  const companyId = activeMembership?.orgId ?? user?.vendorId ?? null;
  const userId = user?.id ?? null;
  const membershipId = activeMembershipId ?? user?.activeMembershipId ?? null;
  const [revision, setRevision] = useState(0);
  const [projection, setProjection] = useState<FleetHomeProjection | null>(null);
  const [visibility, setVisibility] = useState<FleetHomeVisibility>({});
  const [state, setState] = useState<"loading" | "ready" | "warning" | "empty" | "unavailable">("loading");
  const [error, setError] = useState<string | null>(null);
  const retry = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    const listener = () => setRevision(value => value + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  useEffect(() => {
    let alive = true;
    const scope = captureAuthScope();
    setProjection(null); setVisibility({}); setState("loading"); setError(null);
    if (!enabled || !companyId || !userId || !membershipId) {
      setState("unavailable");
      return () => { alive = false; };
    }
    const identity = { companyId, userId, membershipId };
    void Promise.allSettled([
      apiFetch<HomeResult>("/api/fleet/home?module=summary", {}, scope),
      readFleetHomeVisibility(identity),
    ]).then(([home, saved]) => {
      if (!alive || !isAuthScopeCurrent(scope)) return;
      if (saved.status === "fulfilled") setVisibility(saved.value);
      if (home.status === "rejected") { setState("unavailable"); setError("Fleet Home is unavailable. Retry to load your current work."); return; }
      const parsed = FleetHomeProjectionSchema.safeParse(home.value.data);
      if (home.value.module !== "summary" || !parsed.success || parsed.data.companyId !== companyId || parsed.data.userId !== userId) {
        setState("unavailable"); setError("Fleet Home could not verify the current account."); return;
      }
      setProjection(parsed.data);
      setState(home.value.state === "unavailable" ? "warning" : home.value.state);
    });
    return () => { alive = false; };
  }, [enabled, companyId, userId, membershipId, revision]);

  return { projection, visibility, state, error, retry };
}
