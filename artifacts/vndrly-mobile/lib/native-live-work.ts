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
import { currentNativeCaptureContext } from "./native-capture-context";
import { readNativeOperations } from "./native-operations";

let generation = 0,
  observing = false;
let selectedRunId: string | null = null;
function observeAccount() {
  if (observing) return;
  observing = true;
  const stop = () => { void stopNativeWorkActivity().catch(() => undefined); };
  subscribeUser(stop); subscribeToken(stop);
}
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
      company: user.availableMemberships?.find(item => item.id === user.activeMembershipId)?.orgName?.slice(0, 100) ?? "VNDRLY",
      identifier: run.title.slice(0, 100),
      site: run.stops.find(stop => stop.id === run.currentStopId) ? `Site ${run.stops.find(stop => stop.id === run.currentStopId)!.siteId}` : "",
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

/** Retained worker selection is re-read with current assignment/duty authority for each projection. */
export async function refreshSelectedNativeWorkActivity() {
  if (Platform.OS !== "ios" || !NativeSystem) return;
  observeAccount();
  const scope = captureAuthScope(), request = ++generation;
  const current = () => request === generation && isAuthScopeCurrent(scope);
  const status = await readNativeOperations(scope);
  const selected = status.tasks?.find(task => task.kind === status.selectedTask?.kind && task.id === status.selectedTask?.id);
  if (!current()) return;
  if (!status.policy.enabled || !status.duty?.active || !selected || ["ended", "cancelled", "completed", "off_site", "approved", "submitted", "funds_dispersed"].includes(selected.status)) {
    await stopNativeWorkActivity(); return;
  }
  const context = await currentNativeCaptureContext(scope), user = await getUser();
  if (!current() || !user || (status.company && (status.company.type !== context.account.orgType || status.company.id !== context.account.orgId))) return;
  selectedRunId = selected.id;
  await NativeSystem.setContext(context.binding);
  context.assertCurrent();
  if (!current()) return;
  const now = Math.floor(Date.now() / 1000);
  const phases = ["assigned", "en_route", "on_location", "on_site", "on_duty", "paused", "in_progress"];
  await NativeSystem.updateWorkActivity({
    contextBinding: context.binding, subjectKind: selected.kind === "gate" ? "shift" : selected.kind,
    subjectId: selected.id, phase: phases.includes(selected.status) ? selected.status as "on_duty" : "on_duty",
    recordedAt: now, expiresAt: now + 300,
    company: user.availableMemberships?.find(item => item.id === user.activeMembershipId)?.orgName?.slice(0, 100) ?? "VNDRLY",
    site: selected.site?.slice(0, 100) ?? "", identifier: selected.identifier.slice(0, 100),
    startedAt: selected.startedAt ? Math.floor(Date.parse(selected.startedAt) / 1000) : undefined,
    eta: selected.eta ? Math.floor(Date.parse(selected.eta) / 1000) : undefined,
  });
  if (!current()) await stopNativeWorkActivity().catch(() => undefined);
}
