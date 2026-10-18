import type { SessionPayload } from "../lib/session";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";
import {
  MARKETPLACE_TOOL_METADATA,
  sanitizeMarketplaceInput,
} from "./marketplace-tool-catalog";
export type MarketplaceDomainCall = typeof callNaturalVoiceDomainApi;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const positive = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new Error("Select an exact saved marketplace record.");
  return Number(value);
};
const failed = (value: unknown) =>
  Boolean(record(value).error || record(value).ok === false);
const items = (value: unknown) =>
  Array.isArray(record(value).items)
    ? (record(value).items as Record<string, unknown>[])
    : [];

/** The authenticated canonical API invokes the same shared services as web/mobile.
 * No SQL, eligibility facts, classifier decisions or projection policy lives here.
 * authorizedByServer is an execution-context flag, never a model argument.
 */
export async function runMarketplaceTool(
  name: string,
  input: unknown,
  session: SessionPayload,
  authorizedByServer = false,
  call: MarketplaceDomainCall = callNaturalVoiceDomainApi,
): Promise<unknown> {
  let mutationAttempted = false;
  try {
    const metadata = MARKETPLACE_TOOL_METADATA[name];
    if (
      !metadata ||
      !session.userId ||
      session.publicDemo ||
      !metadata.roles.includes(session.role as "admin" | "partner" | "vendor")
    )
      return {
        ok: false,
        error: "Marketplace tools are unavailable in this account scope.",
      };
    const raw = record(input);
    const args = sanitizeMarketplaceInput(name, raw);
    if (args.vendorId != null && args.partnerId != null)
      throw new Error("Select one company scope for this marketplace request.");
    const scope = (side: "vendor" | "partner") => {
      const field = side === "vendor" ? "vendorId" : "partnerId";
      if (session.role === "admin") return positive(args[field]);
      if (
        session.role !== side ||
        session[side === "vendor" ? "partnerId" : "vendorId"] != null ||
        (args[field] !== undefined && args[field] !== session[field])
      )
        throw new Error("Use the active company scope.");
      return positive(session[field]);
    };
    const query = (fields: string[]) => {
      const params = new URLSearchParams();
      for (const key of fields)
        if (args[key] !== undefined) params.set(key, String(args[key]));
      return params.size ? `?${params}` : "";
    };
    const base = "/service-marketplace";
    const get = (path: string) => call(path, "GET", {}, session);
    const side =
      session.role === "admin"
        ? args.vendorId != null
          ? "vendor"
          : "partner"
        : session.role;
    if (!metadata.mutating) {
      if (name === "query_marketplace_job_offers")
        return args.offerId != null
          ? get(`${base}/job-offers/${positive(args.offerId)}`)
          : get(
              `${base}/${side}s/${scope(side as "vendor" | "partner")}/job-offers`,
            );
      if (name === "prepare_marketplace_capability")
        return call(
          `${base}/vendors/${scope("vendor")}/capabilities/preview`,
          "POST",
          record(args.payload),
          session,
        );
      if (
        name === "query_marketplace_capabilities" ||
        (name === "explain_marketplace_match" && side === "vendor")
      ) {
        const result = await get(
          `${base}/vendors/${scope("vendor")}/capabilities`,
        );
        if (failed(result) || name === "query_marketplace_capabilities")
          return result;
        return (
          items(result).find(
            (row) => row.id === positive(args.capabilityId),
          ) ?? { ok: false, error: "Capability unavailable." }
        );
      }
      let result: unknown;
      if (
        name === "query_marketplace_demand" ||
        (name === "search_marketplace_services" && side === "vendor")
      )
        result = await get(
          `${base}/vendors/${scope("vendor")}/matching-demand${query(["limit", "offset"])}`,
        );
      else {
        const partnerId = scope("partner");
        if (
          name === "search_marketplace_services" &&
          (!args.workTypeId || !args.siteId)
        )
          return {
            items: [],
            requiresSelection: true,
            message:
              "Select a saved partner work type and site to compare matching vendors.",
          };
        const workTypeId = positive(args.workTypeId);
        positive(args.siteId);
        result = await get(
          `${base}/partners/${partnerId}/work-types/${workTypeId}/vendors${query(["siteId", "requestedCapacity", "sort", "limit", "offset"])}`,
        );
      }
      if (failed(result)) return result;
      if (name === "explain_marketplace_match")
        return (
          items(result).find(
            (row) => row.capabilityId === positive(args.capabilityId),
          ) ?? {
            ok: false,
            error: "Matching vendor unavailable in this comparison.",
          }
        );
      if (
        name === "search_marketplace_services" &&
        typeof args.query === "string" &&
        args.query.trim()
      ) {
        const needle = args.query.trim().toLowerCase();
        return {
          ...record(result),
          items: items(result).filter((row) =>
            [
              row.name,
              row.description,
              row.partnerName,
              row.vendorName,
              row.capabilityName,
            ].some(
              (value) =>
                typeof value === "string" &&
                value.toLowerCase().includes(needle),
            ),
          ),
          filteredWithinPage: true,
        };
      }
      return result;
    }
    if (
      !authorizedByServer ||
      raw.confirmed !== true ||
      typeof raw.idempotencyKey !== "string" ||
      !raw.idempotencyKey.trim()
    )
      return {
        ok: false,
        requiresConfirmation: true,
        error: "Confirm the exact proposed marketplace action first.",
      };
    const headers = { "Idempotency-Key": raw.idempotencyKey };
    const write = async (
      path: string,
      method: "POST" | "PATCH" | "PUT",
      body: Record<string, unknown>,
    ) => {
      mutationAttempted = true;
      const output = await call(path, method, body, session, headers);
      return failed(output) && Number(record(output).status) >= 500
        ? { ...record(output), outcomeUnknown: true }
        : output;
    };
    const payload = record(args.payload);
    let result: unknown;
    let readback: string;
    if (name === "confirm_marketplace_job_offer_action") {
      const offerId = positive(args.offerId);
      const version = positive(args.version);
      if (
        !["send", "review", "withdraw", "decline", "accept"].includes(
          String(args.action),
        )
      )
        throw new Error("Select a supported offer action.");
      result = await write(
        `${base}/job-offers/${offerId}/${args.action}`,
        "POST",
        { version },
      );
      readback = `${base}/job-offers/${offerId}`;
    } else if (name === "confirm_marketplace_job_offer") {
      result = await write(`${base}/job-offers`, "POST", payload);
      if (failed(result)) return result;
      readback = `${base}/job-offers/${positive(record(result).id)}`;
    } else {
      const vendorBase = `${base}/vendors/${scope("vendor")}`;
      if (name === "confirm_marketplace_capability") {
        result = await write(
          `${vendorBase}/capabilities${args.capabilityId == null ? "" : `/${positive(args.capabilityId)}`}`,
          args.capabilityId == null ? "POST" : "PATCH",
          payload,
        );
        readback = `${vendorBase}/capabilities`;
      } else if (name === "confirm_marketplace_rate") {
        result = await write(`${vendorBase}/partner-rates`, "PUT", payload);
        readback = `${vendorBase}/partner-rates`;
      } else {
        result = await write(`${vendorBase}/service-areas`, "PUT", payload);
        readback = `${vendorBase}/service-areas`;
      }
    }
    if (failed(result)) return result;
    const canonical = await get(readback);
    if (failed(canonical))
      return {
        ok: false,
        outcomeUnknown: true,
        error:
          "The mutation returned, but canonical readback is unavailable. Read the saved record before retrying.",
      };
    if ("items" in record(canonical))
      return (
        items(canonical).find((row) => row.id === record(result).id) ?? {
          ok: false,
          outcomeUnknown: true,
          error: "Saved record was not found during canonical readback.",
        }
      );
    if (
      name === "confirm_marketplace_job_offer_action" &&
      args.action === "accept"
    ) {
      const saved = record(canonical);
      if (
        saved.status !== "accepted" ||
        !Number.isSafeInteger(saved.createdTicketId) ||
        saved.createdTicketId !== record(result).ticketId
      )
        return {
          ok: false,
          outcomeUnknown: true,
          error:
            "Acceptance and canonical ticket readback disagree. Inspect the offer before retrying.",
        };
      return {
        ...saved,
        ticketId: saved.createdTicketId,
        ...(record(result).automaticBilling
          ? { automaticBilling: record(result).automaticBilling }
          : {}),
      };
    }
    return canonical;
  } catch (error) {
    return {
      ok: false,
      ...(mutationAttempted ? { outcomeUnknown: true } : {}),
      error:
        error instanceof Error
          ? error.message
          : "Marketplace request unavailable.",
    };
  }
}
