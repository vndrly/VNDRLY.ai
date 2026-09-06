import type { SessionPayload } from "../lib/session";
import { buildDeepLink } from "./deep-links";
import { gateDeepLinkScreen, type AssistantRole } from "./permissions";
const CLIENT_TOOLS = new Set([
  "open_screen",
  "focus_control",
  "prefill_draft",
  "launch_camera",
  "launch_maps",
  "launch_scanner",
  "start_ticket_entry",
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
    const gate = gateDeepLinkScreen(session.role as AssistantRole, args.screen);
    if (!gate.ok) return fail(gate.error);
    if (args.id != null && (!Number.isSafeInteger(args.id) || Number(args.id) <= 0)) return fail("Choose a valid record.");
    const link = buildDeepLink({
      screen: args.screen,
      id: typeof args.id === "number" ? args.id : undefined,
    });
    if (typeof link !== "string") return fail(link.error);
    args.path = link;
  }
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
    if (args.form !== "safety-report")
      return fail("Choose the supported safety-report draft form.");
    args.path = "/safety-report";
    if (args.values != null) {
      try {
        const values =
          typeof args.values === "string"
            ? JSON.parse(args.values)
            : args.values;
        if (!values || typeof values !== "object" || Array.isArray(values))
          return fail("Draft values must be an object.");
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
