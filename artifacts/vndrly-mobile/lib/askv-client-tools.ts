import { isGateReleasePath } from "./gate-release";
import { gateLogViewPath, waitForGateLogView, waitForGateMapView, readVoicePageContext, subscribeVoicePageContext } from "@workspace/gate-booth";
import { nativeAskVContextPath } from "./askv-context-path";
import { router } from "expo-router";
import { Linking } from "react-native";
import { getApiBase, apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { resolveAssistantLink } from "./assistant-deep-links";
import { workHubItemDestination } from "@workspace/api-client-react/work-hub-destinations";

export interface AskVClientIntent {
  name: string;
  arguments: Record<string, unknown>;
}
export interface AskVClientResult {
  ok: boolean;
  message: string;
  opened?: boolean;
  saved?: boolean;
  responseMode?: "silent";
  page?: number; total?: number; records?: string[];
}
/** Must stay equal to the server-emitted intent catalog. */
export const ASKV_NATIVE_CLIENT_INTENT_NAMES = Object.freeze([
  "open_screen",
  "focus_control",
  "prefill_draft",
  "prefill_gate_visit",
  "launch_camera",
  "launch_maps",
  "launch_scanner",
  "start_ticket_entry",
]);
const controls = new Map<string, () => boolean>();
let recentControlDestination: { path: string; scope: ReturnType<typeof captureAuthScope>; expires: number } | null = null;
function controlPath(path: string): string {
  const route = (path.split(/[?#]/, 1)[0] || "/").replace(/^\/\(tabs\)/, "") || "/";
  return /^\/work-hub\/(?:tasks|tasks-forms)$/.test(route) ? "/work-hub/managed-crews" : route;
}
function noteControlDestination(path: string): void {
  recentControlDestination = { path: controlPath(path), scope: captureAuthScope(), expires: Date.now() + 10_000 };
}
const dataChanged = new Set<() => void>();
export type AskVGatePrefill = {
  mode: "check-in" | "check-out";
  values: Record<string, unknown>;
  provenance: Record<string, unknown>;
  matches: Array<{ id: number }>;
  missing: string[];
};
const gatePrefillListeners = new Set<(prefill: AskVGatePrefill) => void | Promise<void>>();
export type AskVGateCreateDraft = { requestId: string; target?: "administration" | "map-draft"; siteId?: number; name?: string; latitude?: number; longitude?: number; address?: string };
export type AskVGateCreateDraftResult = { requestId: string; ok: boolean; reason?: string; state?: { mode: string; siteId?: number; missing: string[]; readyToReview: boolean } };
const gateCreateDraftListeners = new Set<(draft: AskVGateCreateDraft) => Promise<AskVGateCreateDraftResult>>();
export function subscribeAskVGateCreateDraft(listener: (draft: AskVGateCreateDraft) => Promise<AskVGateCreateDraftResult>): () => void {
  gateCreateDraftListeners.add(listener);
  return () => { gateCreateDraftListeners.delete(listener); };
}
export function subscribeAskVGatePrefill(
  listener: (prefill: AskVGatePrefill) => void | Promise<void>,
): () => void {
  gatePrefillListeners.add(listener);
  return () => {
    gatePrefillListeners.delete(listener);
  };
}
function readGatePrefill(args: Record<string, unknown>): AskVGatePrefill {
  const mode = args.mode === "check-out" ? "check-out" : "check-in";
  const raw =
    args.values &&
    typeof args.values === "object" &&
    !Array.isArray(args.values)
      ? (args.values as Record<string, unknown>)
      : {};
  const allowed = new Set([
    "firstName",
    "lastName",
    "company",
    "vehiclePlate",
    "plateState",
    "purpose",
    "notes",
    "expectedDurationMinutes",
    "siteLocationId",
    "gateStationId",
  ]);
  const values = Object.fromEntries(
    Object.entries(raw).filter(
      ([key, value]) =>
        allowed.has(key) &&
        (typeof value === "string" || typeof value === "number"),
    ),
  );
  const matches = Array.isArray(args.matches)
    ? args.matches.flatMap((match) => {
        const id = Number((match as { id?: unknown })?.id);
        return Number.isSafeInteger(id) && id > 0 ? [{ id }] : [];
      })
    : [];
  const missing = Array.isArray(args.missing)
    ? args.missing.filter((value): value is string => typeof value === "string")
    : [];
  const provenance =
    args.provenance &&
    typeof args.provenance === "object" &&
    !Array.isArray(args.provenance)
      ? (args.provenance as Record<string, unknown>)
      : {};
  return { mode, values, provenance, matches, missing };
}
async function waitForGatePrefillListener(scope: ReturnType<typeof captureAuthScope>): Promise<boolean> {
  const deadline = Date.now() + 8_000;
  while (!gatePrefillListeners.size && Date.now() < deadline) {
    if (!isAuthScopeCurrent(scope)) return false;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return isAuthScopeCurrent(scope) && gatePrefillListeners.size > 0;
}
export function emitAskVDataChanged(): void {
  dataChanged.forEach((listener) => listener());
}
export function subscribeAskVDataChanged(listener: () => void): () => void {
  dataChanged.add(listener);
  return () => {
    dataChanged.delete(listener);
  };
}
export function registerAskVControl(
  path: string,
  id: string,
  focus: () => boolean,
): () => void {
  const key = controlPath(path) + ":" + id;
  controls.set(key, focus);
  return () => {
    if (controls.get(key) === focus) controls.delete(key);
  };
}
export function registerAskVControlAliases(
  paths: readonly string[],
  id: string,
  focus: () => boolean,
): () => void {
  const remove = [...new Set(paths)].map((path) =>
    registerAskVControl(path, id, focus),
  );
  return () => remove.forEach((unregister) => unregister());
}
const screens: Record<string, string> = {
  "gate-map": "/(tabs)/gate-map",
  "gate-dashboard": "/(tabs)/change-over",
  "gate-log": "/(tabs)/gate-history",
  fleet: "/(tabs)/fleet",
  "fleet-log": "/(tabs)/fleet-log",
  "fleet-map": "/(tabs)/fleet-map",
  "company-operations": "/company-operations",
  "work-hub": "/(tabs)/work-hub",
  "work-hub-calendar": "/work-hub/calendar",
  "work-hub-attention": "/work-hub/attention",
  "work-hub-safety": "/work-hub/safety",
  "work-hub-my-work": "/work-hub/my-work",
  home: "/(tabs)",
  dashboard: "/(tabs)",
  tickets: "/(tabs)",
  schedule: "/work-hub/calendar",
  askv: "/(tabs)/askv",
  gate: "/(tabs)/gate",
  "gate-history": "/(tabs)/gate-history",
  "crew-map": "/(tabs)/crew-map",
  crews: "/(tabs)/crews",
  profile: "/(tabs)/profile",
  notifications: "/notifications",
  "safety-report": "/safety-report",
  "safety-my-reports": "/safety-my-reports",
};
const eventTypes = new Set([
  "near_miss",
  "unsafe_condition",
  "unsafe_act",
  "injury",
  "property_damage",
  "observation",
]);
export function readAskVSafetyDraft(value: unknown): Record<string, string> {
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Safety draft fields must be an object.");
  const fields = raw as Record<string, unknown>;
  const draft: Record<string, string> = {};
  for (const key of ["title", "description"] as const) {
    if (typeof fields[key] === "string")
      draft[key] = fields[key].slice(0, key === "title" ? 200 : 8000);
  }
  if (fields.eventType != null) {
    if (!eventTypes.has(String(fields.eventType)))
      throw new Error("Choose a supported safety event type.");
    draft.eventType = String(fields.eventType);
  }
  for (const key of ["siteLocationId", "ticketId"] as const) {
    if (fields[key] != null) {
      if (
        !Number.isSafeInteger(Number(fields[key])) ||
        Number(fields[key]) <= 0
      )
        throw new Error("Choose an exact site or ticket.");
      draft[key] = String(fields[key]);
    }
  }
  return draft;
}
function ticketId(value: unknown): number | null {
  return Number.isSafeInteger(Number(value)) && Number(value) > 0
    ? Number(value)
    : null;
}
const fail = (message: string): AskVClientResult => ({ ok: false, message });
const opened = (message: string): AskVClientResult => ({
  ok: true,
  opened: true,
  saved: false,
  message,
});

/** Re-read exact records before navigation; a link never grants access. */
export async function openAuthorizedAssistantLink(
  href: string,
): Promise<AskVClientResult> {
  const target = resolveAssistantLink(href);
  if (!target) return fail("This destination is not available.");
  try {
    if (target.type !== "browser" && !isGateReleasePath(target.path))
      return fail(
        "This workflow is available in the VNDRLY web app. This release supports Gate operations.",
      );
    if (target.type === "browser") {
      if (!isGateReleasePath(new URL(target.url).pathname))
        return fail(
          "This workflow is available in the VNDRLY web app outside this Gate release.",
        );
      await Linking.openURL(target.url);
      return opened("Opened this VNDRLY screen in the browser.");
    }
    const detail = target.path.match(
      /^\/work-hub\/search-item\/([^/]+)\/([^/?]+)/,
    );
    const meeting = target.path.match(/^\/work-hub\/meeting\/([^/?]+)/);
    const assetId = new URLSearchParams(target.path.split("?")[1] ?? "").get(
      "assetId",
    );
    const destination = detail
      ? workHubItemDestination(detail[1], detail[2])
      : meeting
        ? workHubItemDestination("meeting", meeting[1])
        : assetId
          ? workHubItemDestination("asset", assetId)
          : null;
    if (destination) {
      const scope = captureAuthScope();
      await apiFetch(`/api${destination.readPath}`);
      if (!isAuthScopeCurrent(scope))
        return fail("Your active account changed. Open the item again.");
    }
    noteControlDestination(target.path);
    router.push(target.path as never);
    return opened("Opened the requested screen.");
  } catch (error) {
    return fail(
      error instanceof Error
        ? error.message
        : "This item is no longer available.",
    );
  }
}

/** Only explicit, validated app capabilities execute here. No result claims a record was saved. */
export async function executeAskVClientIntent(
  intent: AskVClientIntent,
  path: string,
): Promise<AskVClientResult> {
  const args = intent.arguments;
  if (intent.name === "start_ticket_entry")
    return fail("Field tickets are available in the VNDRLY web app.");
  try {
    if (intent.name === "prefill_gate_visit") {
      const prefill = readGatePrefill(args);
      const scope = captureAuthScope();
      if (!/\/(?:\(tabs\)\/)?gate(?:[/?#]|$)/.test(path)) {
        noteControlDestination("/(tabs)/gate");
        router.push("/(tabs)/gate" as never);
      }
      if (!await waitForGatePrefillListener(scope)) return fail("Gate form did not open. Nothing was submitted.");
      await Promise.all([...gatePrefillListeners].map(listener => listener(prefill)));
      const result = opened(
        prefill.missing.length
          ? `Gate form filled. Still needed: ${prefill.missing.join(", ")}.`
          : "Gate form filled and ready for review.",
      );
      return prefill.missing.length
        ? result
        : { ...result, responseMode: "silent" };
    }
    if (intent.name === "focus_control") {
      const controlId = String(args.controlId);
      const current = controls.get(controlPath(path) + ":" + controlId);
      if (current?.()) return opened("Focused the requested control.");
      const destination = recentControlDestination;
      if (destination && destination.expires >= Date.now() && isAuthScopeCurrent(destination.scope)) {
        const deadline = Math.min(destination.expires, Date.now() + 3_500);
        while (Date.now() < deadline && isAuthScopeCurrent(destination.scope)) {
          const focus = controls.get(destination.path + ":" + controlId);
          if (focus?.()) {
            if (recentControlDestination === destination) recentControlDestination = null;
            return opened("Focused the requested control.");
          }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      if (recentControlDestination === destination) recentControlDestination = null;
      return fail("That control is not available on the current screen.");
    }
    if (intent.name === "open_screen") {
      if (args.screen === "gate-log" && typeof args.mobilePath === "string" && /^\/\(tabs\)\/gate-history(?:\?|$)/.test(args.mobilePath)) {
        const target = gateLogViewPath(args.mobilePath, readVoicePageContext(nativeAskVContextPath(path)));
        router.push(target as never);
        return waitForGateLogView(target, () => readVoicePageContext("/gate/history"), subscribeVoicePageContext);
      }
      if (
        typeof args.path === "string" &&
        /^\/work-hub(?:\/|$)/.test(args.path)
      )
        return openAuthorizedAssistantLink(args.path);
      if (
        screens[String(args.screen)] &&
        ["work-hub-attention", "work-hub-safety", "work-hub-my-work"].includes(
          String(args.screen),
        )
      ) {
        noteControlDestination(screens[String(args.screen)]);
        router.push(screens[String(args.screen)] as never);
        return opened("Opened the requested Work Hub screen.");
      }
      if (
        String(args.screen).startsWith("work-hub") ||
        args.screen === "shift-notes"
      )
        return openAuthorizedAssistantLink(`vndrly-deep-link:${args.screen}`);
      let target = screens[String(args.screen)];
      if (
        target &&
        ["gate-dashboard", "gate-map"].includes(String(args.screen))
      ) {
        const params = new URLSearchParams();
        if (Number.isSafeInteger(args.siteId) && Number(args.siteId) > 0)
          params.set("siteId", String(args.siteId));
        if (
          typeof args.stationId === "string" &&
          /^[0-9a-f-]{36}$/i.test(args.stationId)
        )
          params.set("stationId", args.stationId);
        if (args.screen === "gate-map") {
          if (Number.isSafeInteger(args.staffUserId) && Number(args.staffUserId) > 0) params.set("staffUserId", String(args.staffUserId));
          if (typeof args.equipmentId === "string" && /^[0-9a-f-]{36}$/i.test(args.equipmentId)) params.set("equipmentId", args.equipmentId);
          if (["staff", "equipment"].includes(String(args.reveal))) params.set("reveal", String(args.reveal));
        }
        if (params.size) target += `?${params}`;
      }
      const id = ticketId(args.id);
      if (args.screen === "ticket-detail" && id) target = "/ticket/" + id;
      if (args.screen === "invoice-detail" && id) target = "/invoice/" + id;
      if (target) {
        if (!isGateReleasePath(target))
          return fail(
            "This workflow is available in the VNDRLY web app. This release supports Gate operations.",
          );
        noteControlDestination(target);
        router.push(target as never);
        if (args.screen === "gate-map" && (args.staffUserId || args.equipmentId || args.reveal)) return waitForGateMapView(target, () => readVoicePageContext("/gate/map"), subscribeVoicePageContext);
        return opened("Opened the requested screen.");
      }
      // Server-generated web deep links are permission checked; never accept arbitrary hosts.
      if (
        typeof args.path === "string" &&
        /^\/[a-z0-9/-]+(?:\?[^\r\n]*)?$/i.test(args.path)
      ) {
        if (!isGateReleasePath(args.path))
          return fail(
            "This workflow is available in the VNDRLY web app outside this Gate release.",
          );
        await Linking.openURL(getApiBase() + args.path);
        return opened("Opened this VNDRLY screen in the browser.");
      }
      return fail("This screen is not available on this device.");
    }
    if (intent.name === "launch_scanner") {
      router.push("/work-hub/my-work" as never);
      return opened("Opened assigned work. QR job starts have been retired.");
    }
    if (intent.name === "launch_maps") {
      let destination: string;
      if (
        typeof args.latitude === "number" &&
        typeof args.longitude === "number" &&
        Number.isFinite(args.latitude) &&
        Number.isFinite(args.longitude) &&
        Math.abs(args.latitude) <= 90 &&
        Math.abs(args.longitude) <= 180
      ) {
        destination = args.latitude + "," + args.longitude;
      } else if (typeof args.query === "string" && args.query.trim())
        destination = args.query.trim().slice(0, 500);
      else return fail("Tell me the destination before I open maps.");
      await Linking.openURL(
        "https://maps.apple.com/?q=" + encodeURIComponent(destination),
      );
      return opened("Opened maps for the destination.");
    }
    if (
      intent.name === "launch_camera" ||
      intent.name === "start_ticket_entry"
    ) {
      const id =
        ticketId(args.ticketId) ??
        ticketId(path.match(/\/tickets?\/(\d+)/)?.[1]);
      const kind =
        intent.name === "launch_camera" ? "photo" : String(args.kind);
      if (!id || !["photo", "parts", "labor", "mileage"].includes(kind))
        return fail("Choose an exact ticket and entry type first.");
      router.push({
        pathname: "/ticket/[id]",
        params: {
          id: String(id),
          askvEntry: kind,
          askvEntryId: String(Date.now()),
        },
      } as never);
      return opened(
        "Opened the ticket entry flow. Nothing has been saved; review and complete the form.",
      );
    }
    if (intent.name === "prefill_draft") {
      if (args.form === "gate-create") {
        const values = typeof args.values === "string" ? JSON.parse(args.values) : args.values;
        if (!values || typeof values !== "object" || Array.isArray(values)) return fail("Gate draft details are invalid.");
        const fields = values as Record<string, unknown>;
        if (Object.keys(fields).some(key => !["siteId", "name", "latitude", "longitude", "address"].includes(key))) return fail("Gate draft details are invalid.");
        if (fields.siteId !== undefined && (!Number.isSafeInteger(fields.siteId) || Number(fields.siteId) <= 0)) return fail("Gate site is invalid.");
        if (fields.name !== undefined && (typeof fields.name !== "string" || fields.name.trim().length > 80)) return fail("Gate name is invalid.");
        if (fields.address !== undefined && (typeof fields.address !== "string" || fields.address.length > 500)) return fail("Gate address is invalid.");
        if (fields.latitude !== undefined && (typeof fields.latitude !== "number" || !Number.isFinite(fields.latitude) || Math.abs(fields.latitude) > 90)) return fail("Gate latitude is invalid.");
        if (fields.longitude !== undefined && (typeof fields.longitude !== "number" || !Number.isFinite(fields.longitude) || Math.abs(fields.longitude) > 180)) return fail("Gate longitude is invalid.");
        if (fields.address !== undefined && (fields.latitude !== undefined || fields.longitude !== undefined)) return fail("Use coordinates or an address.");
        const scope = captureAuthScope();
        if (!/\/(?:\(tabs\)\/)?gate-map(?:[/?#]|$)/.test(path)) {
          noteControlDestination("/(tabs)/gate-map");
          router.push("/(tabs)/gate-map" as never);
        }
        const deadline = Date.now() + 8_000;
        while (!gateCreateDraftListeners.size && Date.now() < deadline && isAuthScopeCurrent(scope)) await new Promise(resolve => setTimeout(resolve, 50));
        if (!isAuthScopeCurrent(scope) || !gateCreateDraftListeners.size) return fail("Gate Map creation form did not open. Nothing was saved.");
        const draft: AskVGateCreateDraft = { requestId: String(Date.now()) + ":" + Math.random(), target: "administration", ...fields as Partial<AskVGateCreateDraft> };
        const result = await [...gateCreateDraftListeners][0](draft);
        if (!isAuthScopeCurrent(scope)) return fail("Sign-in changed. Nothing was saved.");
        if (result.requestId !== draft.requestId) return fail("Gate draft response did not match the request. Nothing was saved.");
        if (!result.ok) return fail(result.reason || "Gate creation form is unavailable. Nothing was saved.");
        const missing = result.state?.missing ?? [];
        return opened(missing.length ? `Gate draft filled. Still needed: ${missing.join(", ")}. Nothing was saved.` : "Gate draft filled for review. Nothing was saved.");
      }
      if (args.form !== "safety-report")
        return fail("That draft form is not available on this device.");
      const draft = readAskVSafetyDraft(args.values ?? {});
      router.push({
        pathname: "/safety-report",
        params: { ...draft, askvDraftId: String(Date.now()) },
      } as never);
      return opened(
        "Opened the safety-report draft for review. It has not been submitted.",
      );
    }
    return fail("This device does not support that capability.");
  } catch (reason) {
    return fail(
      reason instanceof Error
        ? reason.message
        : "The requested screen could not be opened.",
    );
  }
}
