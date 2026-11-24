import type { SessionPayload } from "../lib/session";
import { buildDeepLink } from "./deep-links";
import { gateDeepLinkScreen, type AssistantRole } from "./permissions";
import { parseGateReportFilters } from "../services/gate-report-filters";
const CLIENT_TOOLS = new Set([
  "open_screen",
  "focus_control",
  "prefill_draft",
  "launch_camera",
  "launch_maps",
  "launch_scanner",
  "start_ticket_entry",
]);
/** All structured client intents the server can emit, including the Gate handoff. */
export const ASKV_SERVER_CLIENT_INTENT_NAMES = Object.freeze([
  ...CLIENT_TOOLS,
  "prefill_gate_visit",
]);
export function isClientTool(name: string): boolean {
  return CLIENT_TOOLS.has(name);
}
export function runClientTool(
  name: string,
  input: unknown,
  session?: SessionPayload,
): string {
  const fail = (error: string) => JSON.stringify({ ok: false, error });
  if (
    !session?.userId ||
    !["admin", "partner", "vendor", "field_employee"].includes(
      session.role ?? "",
    )
  )
    return fail("Sign in to use this capability.");
  if (!isClientTool(name)) return fail("Unknown client capability.");
  const args =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  if (name === "open_screen") {
    if (typeof args.screen !== "string") return fail("Choose a screen.");
    if (args.screen === "gate-log") {
      const access = gateDeepLinkScreen(session.role as AssistantRole, "gate-log");
      if (!access.ok) return fail(access.error);
      const params = new URLSearchParams();
      if (args.siteId != null) {
        let filters;
        try { filters = parseGateReportFilters({ siteId: args.siteId, stationId: args.stationId, range: args.from != null || args.to != null ? "custom" : args.range ?? "current_shift", from: args.from, to: args.to, recordType: args.recordType ?? "all", search: args.search }); }
        catch { return fail("Choose an authorized Gate and a valid start/end time window."); }
        for (const [key, value] of Object.entries(filters)) if (value != null) params.set(key, String(value));
      } else if (args.stationId != null || args.from != null || args.to != null) return fail("Resolve the selected Gate site before applying time filters.");
      if (args.page != null) {
        if (!Number.isSafeInteger(args.page) || Number(args.page) < 1 || Number(args.page) > 1000) return fail("Choose a valid records page.");
        params.set("page", String(args.page));
      }
      const suffix = params.size ? `?${params}` : "";
      return JSON.stringify({ ok: true, execution: "client", intent: { name, arguments: { ...args, path: "/gate/history" + suffix, mobilePath: "/(tabs)/gate-history" + suffix } } });
    }
    if (args.screen === "gate-dashboard") {
      const access = gateDeepLinkScreen(session.role as AssistantRole, "gate");
      if (!access.ok) return fail(access.error);
      args.path = "/gate/change-over";
      args.mobilePath = "/(tabs)/change-over";
    }
    if (["gate-dashboard", "gate-map"].includes(args.screen)) {
      if (args.siteId != null && (!Number.isSafeInteger(args.siteId) || Number(args.siteId) <= 0)) return fail("Choose a valid site.");
      if (args.stationId != null && (typeof args.stationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.stationId))) return fail("Choose a valid gate.");
      const params = new URLSearchParams();
      if (args.siteId != null) params.set("siteId", String(args.siteId));
      if (args.stationId != null) params.set("stationId", String(args.stationId));
      if (args.screen === "gate-map") {
        if (args.staffUserId != null && (!Number.isSafeInteger(args.staffUserId) || Number(args.staffUserId) <= 0)) return fail("Choose a valid staff member from the authorized map coverage.");
        if (args.equipmentId != null && (typeof args.equipmentId !== "string" || !/^[0-9a-f-]{36}$/i.test(args.equipmentId))) return fail("Choose a valid equipment record.");
        if (args.staffUserId != null && args.equipmentId != null) return fail("Choose one map target at a time.");
        if (args.reveal != null && !["staff", "equipment"].includes(String(args.reveal))) return fail("Choose staff or equipment locations.");
        for (const key of ["staffUserId", "equipmentId", "reveal"]) if (args[key] != null) params.set(key, String(args[key]));
      }
      const suffix = params.size ? `?${params}` : "";
      if (args.screen === "gate-map") {
        if (session.role === "partner") return fail("Use your current company portal.");
        args.path = "/gate/map";
        args.mobilePath = "/gate-map";
      }
      args.path = String(args.path) + suffix;
      args.mobilePath = String(args.mobilePath) + suffix;
      return JSON.stringify({ ok: true, execution: "client", intent: { name, arguments: args } });
    }
    const nativeScreens: Record<string,string> = {"fleet":"/fleet","fleet-map":"/fleet-map","fleet-log":"/fleet-log","company-operations":"/company-operations","work-hub-attention":"/work-hub/attention","work-hub-safety":"/work-hub/safety","work-hub-my-work":"/work-hub/my-work"};
    if(Object.hasOwn(nativeScreens,args.screen)) {
      if(session.role === "partner" && !args.screen.startsWith("work-hub")) return fail("Use your current company portal.");
      return JSON.stringify({ok:true,execution:"client",intent:{name,arguments:{screen:args.screen,mobilePath:nativeScreens[args.screen]}},message:"Open the native screen; its server permissions still apply. No settings or records were changed."});
    }
    const gate = gateDeepLinkScreen(session.role as AssistantRole, args.screen);
    if (!gate.ok) return fail(gate.error);
    if (args.id != null && (!Number.isSafeInteger(args.id) || Number(args.id) <= 0)) return fail("Choose a valid record.");
    for (const key of ["subjectType", "itemId", "query", "start", "end"])
      if (args[key] != null && typeof args[key] !== "string") return fail("Choose valid navigation values.");
    if (args.types != null && (!Array.isArray(args.types) || args.types.some(value => typeof value !== "string"))) return fail("Choose valid search types.");
    const link = buildDeepLink({
      screen: args.screen,
      id: typeof args.id === "number" ? args.id : undefined,
      subjectType: args.subjectType as string | undefined,
      itemId: args.itemId as string | undefined,
      query: args.query as string | undefined,
      start: args.start as string | undefined,
      end: args.end as string | undefined,
      types: args.types as string[] | undefined,
    });
    if (typeof link !== "string") return fail(link.error);
    args.path = link;
  }
  if (name === "launch_scanner") { args.path = "/work-hub/my-work"; args.mobilePath = "/work-hub/my-work"; }
  if (name === "start_ticket_entry") {
    if (!Number.isSafeInteger(args.ticketId) || Number(args.ticketId) <= 0)
      return fail("Choose the exact ticket first.");
    if (!["photo", "parts", "labor", "mileage"].includes(String(args.kind)))
      return fail("Choose photo, parts, labor, or mileage entry.");
    args.path = `/tickets/${args.ticketId}?askvEntry=${args.kind}`;
    args.mobilePath = `/ticket/${args.ticketId}?askvEntry=${args.kind}`;
  }
  if (
    name === "focus_control" &&
    (typeof args.controlId !== "string" || !args.controlId.trim())
  )
    return fail("Choose a control on the current screen.");
  if (name === "prefill_draft") {
    if (!["safety-report", "gate-create"].includes(String(args.form)))
      return fail("Choose a supported draft form.");
    if (args.form === "gate-create" && session.role === "partner")
      return fail("Use your current company portal.");
    args.path = args.form === "gate-create" ? "/gate/map" : "/safety-report";
    if (args.values != null) {
      try {
        const values =
          typeof args.values === "string"
            ? JSON.parse(args.values)
            : args.values;
        if (!values || typeof values !== "object" || Array.isArray(values))
          return fail("Draft values must be an object.");
        if (args.form === "gate-create") {
          const draft = values as Record<string, unknown>;
          if (Object.keys(draft).some(key => !["siteId", "name", "latitude", "longitude", "address"].includes(key))) return fail("Choose Gate site, name, coordinates, or address only.");
          if (draft.siteId !== undefined && (!Number.isSafeInteger(draft.siteId) || Number(draft.siteId) <= 0)) return fail("Choose a valid site.");
          if (draft.name !== undefined && (typeof draft.name !== "string" || draft.name.trim().length > 80)) return fail("Choose a gate name of 80 characters or fewer.");
          if (draft.address !== undefined && (typeof draft.address !== "string" || draft.address.length > 500)) return fail("Choose an address of 500 characters or fewer.");
          if (draft.latitude !== undefined && (typeof draft.latitude !== "number" || !Number.isFinite(draft.latitude) || Math.abs(draft.latitude) > 90)) return fail("Choose a latitude between -90 and 90.");
          if (draft.longitude !== undefined && (typeof draft.longitude !== "number" || !Number.isFinite(draft.longitude) || Math.abs(draft.longitude) > 180)) return fail("Choose a longitude between -180 and 180.");
          if (draft.address !== undefined && (draft.latitude !== undefined || draft.longitude !== undefined)) return fail("Use coordinates or an address in one draft update.");
          args.values = draft;
        }
      } catch {
        return fail("Draft values must be valid JSON.");
      }
    }
  }
  return JSON.stringify({
    ok: true,
    execution: "client",
    intent: { name, arguments: args },
  });
}
