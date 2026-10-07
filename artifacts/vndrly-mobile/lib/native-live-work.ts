import { Platform } from "react-native";
import type { FleetOverview, FleetRun } from "@workspace/api-zod";
import NativeSystem from "../modules/vndrly-system-surfaces/src/VndrlySystemSurfacesModule";
import { apiFetch } from "./api";
import {
  captureAuthScope,
  getUser,
  isAuthScopeCurrent,
  subscribeToken,
  subscribeUser,
} from "./auth";
import { fleetLiveActivityBinding } from "./native-live-work-policy";

let generation = 0,
  observing = false;
let selectedRunId: string | null = null;
export async function stopNativeWorkActivity(runId?: string) {
  if (runId && selectedRunId !== runId) return;
  generation++;
  selectedRunId = null;
  await NativeSystem?.setContext(null);
}

/** A foreground request reads actual assigned duty; no GPS/media or record write. */
export async function showFleetWorkActivity(runId: string) {
  if (Platform.OS !== "ios" || !NativeSystem)
    throw new Error("native_live_work_unavailable");
  if (!observing) {
    observing = true;
    const stop = () => {
      void stopNativeWorkActivity().catch(() => undefined);
    };
    subscribeUser(stop);
    subscribeToken(stop);
  }
  const request = ++generation,
    scope = captureAuthScope();
  selectedRunId = runId;
  const current = () => request === generation && isAuthScopeCurrent(scope);
  try {
    const user = await getUser();
    if (!user || user.requiresContextChoice || !current())
      throw new Error("native_live_work_account_required");
    const overview = await apiFetch<FleetOverview>(
      "/api/fleet/overview",
      {},
      scope,
    );
    if (
      !current() ||
      !overview.accountScope ||
      !overview.capabilities.canDrive ||
      overview.accountScope.userId !== user.id ||
      overview.accountScope.membershipId !== user.activeMembershipId ||
      overview.accountScope.companyId !== user.vendorId
    )
      throw new Error("native_live_work_driver_required");
    const run = await apiFetch<FleetRun>(
      `/api/fleet/runs/${encodeURIComponent(runId)}`,
      {},
      scope,
    );
    if (!current() || run.id !== runId)
      throw new Error("native_live_work_context_changed");
    const binding = fleetLiveActivityBinding({
      account: overview.accountScope,
      expectedAccount: overview.accountScope,
      run,
      fetchedAt: Date.now(),
    });
    await NativeSystem.setContext(binding.contextBinding);
    if (!current()) throw new Error("native_live_work_context_changed");
    const id = await NativeSystem.updateWorkActivity({
      contextBinding: binding.contextBinding,
      subjectKind: "fleet",
      subjectId: binding.sessionId,
      phase: "in_progress",
      recordedAt: Math.floor(binding.updatedAt / 1000),
      expiresAt: Math.floor(binding.staleAt / 1000),
    });
    if (!current()) throw new Error("native_live_work_context_changed");
    return {
      activityId: id,
      source: binding.source,
      fetchedAt: binding.updatedAt,
      staleAt: binding.staleAt,
      physicalTrackingVerified: false as const,
    };
  } catch (error) {
    // Refused or ended duty invalidates an earlier display; a superseded
    // request cannot clear a newer account's activity.
    if (current()) await stopNativeWorkActivity().catch(() => undefined);
    throw error;
  }
}
