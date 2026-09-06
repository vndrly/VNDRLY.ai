import { router } from "expo-router";
import { Linking } from "react-native";
import { getApiBase } from "@/lib/api";

export interface AskVClientIntent { name: string; arguments: Record<string, unknown> }
export interface AskVClientResult { ok: boolean; message: string; opened?: boolean; saved?: boolean }
const controls = new Map<string, () => boolean>();
const dataChanged = new Set<() => void>();
export function emitAskVDataChanged(): void { dataChanged.forEach(listener => listener()); }
export function subscribeAskVDataChanged(listener: () => void): () => void {
  dataChanged.add(listener); return () => { dataChanged.delete(listener); };
}
export function registerAskVControl(path: string, id: string, focus: () => boolean): () => void {
  const key = path + ":" + id;
  controls.set(key, focus);
  return () => { if (controls.get(key) === focus) controls.delete(key); };
}
const screens: Record<string, string> = {
  home: "/(tabs)", dashboard: "/(tabs)", tickets: "/(tabs)", schedule: "/(tabs)/schedule",
  askv: "/(tabs)/askv", gate: "/(tabs)/gate", "gate-history": "/(tabs)/gate-history",
  "crew-map": "/(tabs)/crew-map", crews: "/(tabs)/crews", profile: "/(tabs)/profile",
  notifications: "/notifications", "safety-report": "/safety-report", "safety-my-reports": "/safety-my-reports",
};
const eventTypes = new Set(["near_miss", "unsafe_condition", "unsafe_act", "injury", "property_damage", "observation"]);
export function readAskVSafetyDraft(value: unknown): Record<string, string> {
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Safety draft fields must be an object.");
  const fields = raw as Record<string, unknown>;
  const draft: Record<string, string> = {};
  for (const key of ["title", "description"] as const) {
    if (typeof fields[key] === "string") draft[key] = fields[key].slice(0, key === "title" ? 200 : 8000);
  }
  if (fields.eventType != null) {
    if (!eventTypes.has(String(fields.eventType))) throw new Error("Choose a supported safety event type.");
    draft.eventType = String(fields.eventType);
  }
  for (const key of ["siteLocationId", "ticketId"] as const) {
    if (fields[key] != null) {
      if (!Number.isSafeInteger(Number(fields[key])) || Number(fields[key]) <= 0) throw new Error("Choose an exact site or ticket.");
      draft[key] = String(fields[key]);
    }
  }
  return draft;
}
function ticketId(value: unknown): number | null {
  return Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
}
const fail = (message: string): AskVClientResult => ({ ok: false, message });
const opened = (message: string): AskVClientResult => ({ ok: true, opened: true, saved: false, message });

/** Only explicit, validated app capabilities execute here. No result claims a record was saved. */
export async function executeAskVClientIntent(intent: AskVClientIntent, path: string): Promise<AskVClientResult> {
  const args = intent.arguments;
  try {
    if (intent.name === "focus_control") {
      const focus = controls.get(path + ":" + String(args.controlId));
      return focus?.() ? opened("Focused the requested control.") : fail("That control is not available on the current screen.");
    }
    if (intent.name === "open_screen") {
      let target = screens[String(args.screen)];
      const id = ticketId(args.id);
      if (args.screen === "ticket-detail" && id) target = "/ticket/" + id;
      if (args.screen === "invoice-detail" && id) target = "/invoice/" + id;
      if (target) { router.push(target as never); return opened("Opened the requested screen."); }
      // Server-generated web deep links are permission checked; never accept arbitrary hosts.
      if (typeof args.path === "string" && /^\/[a-z0-9/-]+(?:\?[^\r\n]*)?$/i.test(args.path)) {
        await Linking.openURL(getApiBase() + args.path);
        return opened("Opened this VNDRLY screen in the browser.");
      }
      return fail("This screen is not available on this device.");
    }
    if (intent.name === "launch_scanner") {
      router.push("/(tabs)/scan" as never); return opened("Opened the scanner. No scan has been completed yet.");
    }
    if (intent.name === "launch_maps") {
      let destination: string;
      if (typeof args.latitude === "number" && typeof args.longitude === "number" && Number.isFinite(args.latitude)
        && Number.isFinite(args.longitude) && Math.abs(args.latitude) <= 90 && Math.abs(args.longitude) <= 180) {
        destination = args.latitude + "," + args.longitude;
      } else if (typeof args.query === "string" && args.query.trim()) destination = args.query.trim().slice(0, 500);
      else return fail("Tell me the destination before I open maps.");
      await Linking.openURL("https://maps.apple.com/?q=" + encodeURIComponent(destination));
      return opened("Opened maps for the destination.");
    }
    if (intent.name === "launch_camera" || intent.name === "start_ticket_entry") {
      const id = ticketId(args.ticketId) ?? ticketId(path.match(/\/tickets?\/(\d+)/)?.[1]);
      const kind = intent.name === "launch_camera" ? "photo" : String(args.kind);
      if (!id || !["photo", "parts", "labor", "mileage"].includes(kind)) return fail("Choose an exact ticket and entry type first.");
      router.push({ pathname: "/ticket/[id]", params: { id: String(id), askvEntry: kind, askvEntryId: String(Date.now()) } } as never);
      return opened("Opened the ticket entry flow. Nothing has been saved; review and complete the form.");
    }
    if (intent.name === "prefill_draft") {
      if (args.form !== "safety-report") return fail("That draft form is not available on this device.");
      const draft = readAskVSafetyDraft(args.values ?? {});
      router.push({ pathname: "/safety-report", params: { ...draft, askvDraftId: String(Date.now()) } } as never);
      return opened("Opened the safety-report draft for review. It has not been submitted.");
    }
    return fail("This device does not support that capability.");
  } catch (reason) { return fail(reason instanceof Error ? reason.message : "The requested screen could not be opened."); }
}
