import { createHmac } from "node:crypto";
import { SESSION_SECRET, type SessionPayload } from "../lib/session";

function err(message: string): string {
  return JSON.stringify({ ok: false, error: message });
}
function argsOf(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}
function positiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function missingCheckInFields(args: Record<string, unknown>): string[] {
  const missing: string[] = [];
  if (typeof args.firstName !== "string" || !args.firstName.trim())
    missing.push("firstName");
  if (typeof args.lastName !== "string" || !args.lastName.trim())
    missing.push("lastName");
  if (!positiveId(args.siteLocationId)) missing.push("siteLocationId");
  if (args.hostType !== "partner" && args.hostType !== "vendor")
    missing.push("hostType");
  if (args.hostType === "partner" && !positiveId(args.hostPartnerId))
    missing.push("hostPartnerId");
  if (args.hostType === "vendor" && !positiveId(args.hostVendorId))
    missing.push("hostVendorId");
  if (
    typeof args.latitude !== "number" ||
    !Number.isFinite(args.latitude) ||
    Math.abs(args.latitude) > 90
  )
    missing.push("latitude");
  if (
    typeof args.longitude !== "number" ||
    !Number.isFinite(args.longitude) ||
    Math.abs(args.longitude) > 180
  )
    missing.push("longitude");
  return missing;
}
/** Reuse the real API boundary: assignment, role, geofence, audit, GPS and events. */
export async function callNaturalVoiceDomainApi(
  path: string,
  method: "GET" | "POST" | "PATCH",
  input: Record<string, unknown>,
  session: SessionPayload,
): Promise<Record<string, unknown> | unknown[]> {
  if (!session.userId) return { ok: false, error: "You must be signed in." };
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      ...session,
      iat: session.iat ?? now,
      exp: Math.min(session.exp ?? now + 60, now + 60),
    }),
  ).toString("base64");
  const signature = createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("hex");
  const port = /^\d+$/.test(process.env.PORT ?? "8080")
    ? (process.env.PORT ?? "8080")
    : "8080";
  const {
    confirmed: _confirmed,
    idempotencyKey: _key,
    voiceSessionId: _session,
    ...body
  } = input;
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      cookie: `vndrly_session=${payload}.${signature}`,
    },
    ...(method !== "GET" ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  const result = (await response.json()) as Record<string, unknown> | unknown[];
  if (!response.ok) {
    const failure = Array.isArray(result) ? {} : result;
    return {
      ok: false,
      error: failure.message ?? failure.error ?? "The action did not complete.",
      code: failure.code,
      status: response.status,
      // Onboarding reports exact missing paths so AskV can repair the saved
      // draft using the canonical validator's result.
      ...(Array.isArray(failure.missing) && failure.missing.every((field) => typeof field === "string")
        ? { missing: failure.missing }
        : {}),
    };
  }
  return result;
}
function gatekeeper(session: SessionPayload): boolean {
  return Boolean(
    session.userId &&
    session.role === "vendor" &&
    session.vendorId &&
    session.vendorRole === "gatekeeper",
  );
}
function writeGuard(
  args: Record<string, unknown>,
  confirmed: boolean,
): string | null {
  if (confirmed && args.confirmed !== true)
    return JSON.stringify({
      ok: false,
      error: "Please confirm the exact action first.",
      requiresConfirmation: true,
    });
  if (typeof args.idempotencyKey !== "string" || !args.idempotencyKey.trim())
    return err("An action idempotency key is required.");
  return null;
}
export async function prepareVisitorCheckIn(input: unknown): Promise<string> {
  const args = argsOf(input);
  const missing = missingCheckInFields(args);
  return JSON.stringify({
    ok: missing.length === 0,
    action: "prepare_visitor_check_in",
    missing,
    draft: args,
  });
}
export async function confirmVisitorCheckIn(
  input: unknown,
  session: SessionPayload,
): Promise<string> {
  if (!gatekeeper(session))
    return err("Visitor check-in requires your assigned Gatekeeper account.");
  const args = argsOf(input);
  const guard = writeGuard(args, true);
  if (guard) return guard;
  const missing = missingCheckInFields(args);
  if (missing.length) return err(`Missing ${missing.join(", ")}.`);
  const result = (await callNaturalVoiceDomainApi(
    "/visits/gate/check-in",
    "POST",
    args,
    session,
  )) as Record<string, unknown>;
  return JSON.stringify(
    result.error
      ? result
      : { ok: true, visitId: result.id, refresh: ["gate", "visits"] },
  );
}
export async function findActiveVisitors(
  input: unknown,
  session?: SessionPayload,
): Promise<string> {
  if (
    !session?.userId ||
    !["admin", "partner", "vendor"].includes(session.role ?? "")
  )
    return err("You cannot view visitor records.");
  const args = argsOf(input);
  const query = new URLSearchParams({ activeOnly: "true", limit: "1000" });
  if (positiveId(args.siteLocationId))
    query.set("siteLocationId", String(args.siteLocationId));
  const result = await callNaturalVoiceDomainApi(
    `/visits?${query}`,
    "GET",
    {},
    session,
  );
  if (!Array.isArray(result)) return JSON.stringify(result);
  const needle =
    typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
  const plate =
    typeof args.vehiclePlate === "string"
      ? args.vehiclePlate.trim().toLowerCase()
      : "";
  const matches = result
    .filter((row) => {
      const r = argsOf(row);
      return (
        (!positiveId(args.visitId) || r.id === args.visitId) &&
        (!plate || String(r.vehiclePlate ?? "").toLowerCase() === plate) &&
        (!needle ||
          [
            r.firstName,
            r.lastName,
            `${r.firstName} ${r.lastName}`,
            r.company,
            r.vehiclePlate,
          ].some((value) =>
            String(value ?? "")
              .toLowerCase()
              .includes(needle),
          ))
      );
    })
    .slice(0, 8)
    .map((row) => {
      const r = argsOf(row);
      return {
        id: r.id,
        firstName: r.firstName,
        lastName: r.lastName,
        company: r.company,
        vehiclePlate: r.vehiclePlate,
        siteLocationId: r.siteLocationId,
      };
    });
  return JSON.stringify({ ok: true, matches, needsChoice: matches.length > 1 });
}
export async function prepareVisitorCheckOut(
  input: unknown,
  session?: SessionPayload,
): Promise<string> {
  const found = JSON.parse(await findActiveVisitors(input, session)) as {
    error?: string;
    matches?: unknown[];
    needsChoice?: boolean;
  };
  if (found.error || !found.matches) return JSON.stringify(found);
  return JSON.stringify({
    ok: found.matches.length > 0,
    action: "prepare_visitor_check_out",
    matches: found.matches,
    needsChoice: found.needsChoice,
    missing: found.matches.length ? [] : ["visit"],
  });
}
export async function confirmVisitorCheckOut(
  input: unknown,
  session: SessionPayload,
): Promise<string> {
  if (!gatekeeper(session))
    return err("Visitor check-out requires your assigned Gatekeeper account.");
  const args = argsOf(input);
  const guard = writeGuard(args, true);
  if (guard) return guard;
  if (!positiveId(args.visitId)) return err("A valid visitId is required.");
  const result = (await callNaturalVoiceDomainApi(
    `/visits/gate/${args.visitId}/check-out`,
    "POST",
    args,
    session,
  )) as Record<string, unknown>;
  return JSON.stringify(
    result.error
      ? result
      : { ok: true, visitId: result.id, refresh: ["gate", "visits"] },
  );
}
export async function setTicketLifecycle(
  input: unknown,
  session: SessionPayload,
): Promise<string> {
  const args = argsOf(input);
  const guard = writeGuard(args, false);
  if (guard) return guard;
  if (
    !session.userId ||
    !["admin", "vendor", "field_employee"].includes(session.role ?? "")
  )
    return err("You cannot update tickets.");
  if (!positiveId(args.ticketId)) return err("A valid ticketId is required.");
  const endpoints: Record<string, string> = {
    en_route: "en-route",
    on_location: "on-location",
    on_site: "check-in",
    work_complete: "check-out",
    off_site: "check-out",
  };
  const endpoint =
    typeof args.phase === "string" ? endpoints[args.phase] : undefined;
  if (!endpoint) return err("Unknown lifecycle phase.");
  const result = (await callNaturalVoiceDomainApi(
    `/tickets/${args.ticketId}/${endpoint}`,
    "POST",
    {
      ...args,
      ...(endpoint === "check-out" ? { workCompleted: true } : {}),
    },
    session,
  )) as Record<string, unknown>;
  return JSON.stringify(
    result.error
      ? result
      : { ok: true, ticketId: args.ticketId, refresh: ["tickets", "crew-map"] },
  );
}
export async function closeTicketForReview(
  input: unknown,
  session: SessionPayload,
): Promise<string> {
  const args = argsOf(input);
  const guard = writeGuard(args, true);
  if (guard) return guard;
  if (
    !session.userId ||
    !["admin", "vendor", "field_employee"].includes(session.role ?? "")
  )
    return err("You cannot close tickets.");
  if (!positiveId(args.ticketId)) return err("A valid ticketId is required.");
  const current = (await callNaturalVoiceDomainApi(
    `/tickets/${args.ticketId}`,
    "GET",
    {},
    session,
  )) as Record<string, unknown>;
  if (current.error) return JSON.stringify(current);
  const status =
    current.status ??
    (current.ticket as Record<string, unknown> | undefined)?.status;
  if (typeof status !== "string")
    return err("The current ticket state could not be verified.");
  const submit = ["completed", "pending_review", "kicked_back"].includes(
    status,
  );
  const result = (await callNaturalVoiceDomainApi(
    `/tickets/${args.ticketId}/${submit ? "submit" : "check-out"}`,
    "POST",
    { ...args, workCompleted: false },
    session,
  )) as Record<string, unknown>;
  return JSON.stringify(
    result.error
      ? result
      : {
          ok: true,
          ticketId: args.ticketId,
          status: submit ? "submitted" : "pending_review",
          refresh: ["tickets", "crew-map"],
        },
  );
}
export async function draftSafetyReport(input: unknown): Promise<string> {
  const args = argsOf(input);
  const missing: string[] = [];
  if (typeof args.title !== "string" || !args.title.trim())
    missing.push("title");
  if (!positiveId(args.siteLocationId)) missing.push("siteLocationId");
  if (
    ![
      "near_miss",
      "unsafe_condition",
      "unsafe_act",
      "injury",
      "property_damage",
      "observation",
    ].includes(String(args.eventType))
  )
    missing.push("eventType");
  const draft = Object.fromEntries(
    ["title", "description", "eventType", "siteLocationId", "ticketId"]
      .filter((key) => args[key] != null)
      .map((key) => [key, args[key]]),
  );
  const query = new URLSearchParams();
  if (positiveId(args.siteLocationId))
    query.set("siteLocationId", String(args.siteLocationId));
  if (positiveId(args.ticketId)) query.set("ticketId", String(args.ticketId));
  return JSON.stringify({
    ok: missing.length === 0,
    action: "draft_safety_report",
    submitted: false,
    missing,
    draft,
    ...(missing.length === 0
      ? {
          execution: "client",
          intent: {
            name: "prefill_draft",
            arguments: {
              form: "safety-report",
              values: JSON.stringify(draft),
              path: `/safety-report?${query}`,
            },
          },
        }
      : {}),
  });
}
