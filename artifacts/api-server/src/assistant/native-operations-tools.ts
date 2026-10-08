import { z } from "zod/v4";
import { createHash } from "node:crypto";
import type { Anthropic } from "@workspace/integrations-anthropic-ai/sdk";
import type { WorkHubToolRequest } from "./work-hub-tool-runtime";

const schema = (properties: Record<string, unknown>, required: string[] = []): Anthropic.Tool["input_schema"] => ({ type: "object", properties, required, additionalProperties: false });
const requestProperties = {
  workerUserId: { type: "integer", minimum: 1 }, vendorId: { type: "integer", minimum: 1 },
  siteId: { type: "integer", minimum: 1 }, ticketId: { type: "integer", minimum: 1 },
  purpose: { type: "string", minLength: 1, maxLength: 500 },
  idempotencyKey: { type: "string", format: "uuid", description: "Retain this exact request key across retries; inspect the saved result before creating another request." },
};
export const NATIVE_OPERATIONS_TOOL_ENTRIES: Array<{ tool: Anthropic.Tool; family: "command"; mutating: boolean }> = [
  { family: "command", mutating: false, tool: { name: "query_native_work_status", description: "Read your current company native-work policy, own duty/consent and designated phone, permitted worker targets, and request states. Only enabled company modules and current authority apply. This read does not start duty or tracking, change consent, capture media, or wake a phone.", input_schema: schema({}) } },
  { family: "command", mutating: false, tool: { name: "query_native_device_requests", description: "Read authorized saved device request status and canonical results. Supply requestId to read one exact request; otherwise list permitted requests. Pending, delivered, upload-in-progress and expired are not saved photos. Last-known location is not fresh location.", input_schema: schema({ requestId: { type: "string", format: "uuid" } }) } },
  { family: "command", mutating: true, tool: { name: "request_native_location", description: "Request a fresh observation from the worker's designated work phone for an explicit work purpose after authenticated approval. Server rechecks company/site supervisor grants, active duty and saved worker consent. Five-minute per-worker limit; offline/unreachable is unavailable, not queued. No model coordinates or off-duty tracking. Read the same canonical request for its actual result.", input_schema: schema(requestProperties, ["workerUserId", "vendorId", "purpose", "idempotencyKey"]) } },
  { family: "command", mutating: true, tool: { name: "request_native_ticket_photo", description: "Request worker-reviewed photo evidence on an exact authorized ticket after authenticated approval. Worker explicitly opens camera, reviews and saves; request/delivery/upload is not attachment completion. Offline requests queue until shift end or eight hours. New camera photo is default; allowLibrary explicitly permits existing photo. Reuse request key and inspect canonical saved result.", input_schema: schema({ ...requestProperties, allowLibrary: { type: "boolean", default: false } }, ["workerUserId", "vendorId", "ticketId", "purpose", "idempotencyKey"]) } },
];

const id = z.number().int().positive();
const request = z.object({ workerUserId: id, vendorId: id, siteId: id.optional(), ticketId: id.optional(), purpose: z.string().trim().min(1).max(500), idempotencyKey: z.uuid(), allowLibrary: z.boolean().optional() }).strict();
export function nativeOperationsToolRequest(name: string, raw: unknown, mutationAuthorizedByServer = false): WorkHubToolRequest | null {
  if (!NATIVE_OPERATIONS_TOOL_ENTRIES.some(entry => entry.tool.name === name)) return null;
  try {
    if (name === "query_native_work_status") {
      z.object({}).strict().parse(raw);
      return { method: "GET", path: "/native-operations/status", body: {} };
    }
    if (name === "query_native_device_requests") {
      const value = z.object({ requestId: z.uuid().optional() }).strict().parse(raw);
      return { method: "GET", path: value.requestId ? `/native-operations/requests/${value.requestId}` : "/native-operations/requests", body: {} };
    }
    let canonicalInput = raw;
    if (mutationAuthorizedByServer && raw && typeof raw === "object" && !Array.isArray(raw)) {
      const { confirmed: _confirmation, voiceSessionId: _session, idempotencyKey, ...fields } = raw as Record<string, unknown>;
      if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) return { error: "Server-bound operation identity is required." };
      // Typed AskV/ChatGPT inject their own durable execution keys, which are not
      // necessarily UUIDs. Translate that trusted identity without letting model
      // confirmation or session markers enter the canonical native request schema.
      const hash = createHash("sha256").update(`native-work-request:${idempotencyKey}`).digest("hex");
      const key = z.uuid().safeParse(idempotencyKey).success ? idempotencyKey : `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      canonicalInput = { ...fields, idempotencyKey: key };
    }
    const value = request.parse(canonicalInput);
    if (name === "request_native_ticket_photo" && !value.ticketId) return { error: "Read and select the exact authorized ticket first." };
    if (name === "request_native_location" && value.allowLibrary !== undefined) return { error: "Photo-library settings cannot be supplied for location requests." };
    return { method: "POST", path: "/native-operations/requests", body: { ...value, kind: name === "request_native_location" ? "location" : "photo" } };
  } catch {
    return { error: "Supply the exact authorized worker, company, ticket where required, purpose and original request key. Device measurements and permission claims are not accepted." };
  }
}
