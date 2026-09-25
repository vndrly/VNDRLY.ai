import { capabilityTools } from "./types";
const alias = { type: "object", properties: { kind: { type: "string", enum: ["vin", "plate", "serial", "asset_tag", "model", "other"] }, value: { type: "string" }, jurisdiction: { type: "string" } }, required: ["kind", "value"], additionalProperties: false };
export const ASSET_CAPABILITY_TOOLS = capabilityTools("asset_custody", "asset lookup, checkout, return, condition, and evidence", "events.subscribe", ["admin", "partner", "vendor", "field_employee"]).map(tool => ({
  ...tool,
  description: `${tool.description} Read the exact asset and current version first. Writes require exact-value user confirmation. Never guess holder IDs, version, condition or evidence. Server permissions and holds remain authoritative.`,
  input_schema: {
    type: "object" as const,
    properties: {
      assetId: { type: "string" },
      action: { type: "string", enum: ["create", "aliases", "checkout", "return", "transfer", "condition", "hold", "merge", "verify-issued"] },
      operationId: { type: "string", format: "uuid" },
      expectedVersion: { type: "integer", minimum: 1 },
      payload: { type: "object", properties: {
        name: { type: "string" }, category: { type: "string" }, legalOwner: { type: "string" },
        manufacturer: { type: "string" }, model: { type: "string" },
        aliases: { type: "array", items: alias }, alias,
        condition: { type: "string", enum: ["new", "good", "fair", "damaged", "missing", "stolen"] },
        note: { type: "string" }, photos: { type: "array", items: { type: "string" } },
        expectedReturnAt: { type: "string" }, holderUserId: { type: "integer" }, toHolderUserId: { type: "integer" },
        reason: { type: "string" }, mergedAssetId: { type: "string" },
      }, additionalProperties: false },
    },
    required: tool.mutating ? ["action", "operationId", "payload"] : [],
    additionalProperties: false,
  },
}));
