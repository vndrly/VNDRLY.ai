import { capabilityTools } from "./types";
const alias = { type: "object", properties: { kind: { type: "string", enum: ["vin", "plate", "serial", "asset_tag", "model", "other"] }, value: { type: "string" }, jurisdiction: { type: "string" } }, required: ["kind", "value"], additionalProperties: false };
export const ASSET_CAPABILITY_TOOLS = capabilityTools("asset_custody", "asset lookup, checkout, return, condition, and evidence", "events.subscribe", ["admin", "partner", "vendor", "field_employee"]).map(tool => ({
  ...tool,
  description: `${tool.description} Read the exact asset and current version first. Checkout, return, transfer, and verify-issued require payload.condition as well as expectedVersion. If condition is unknown, ask the user before preparing; never invent it. Writes require exact-value user confirmation. Never guess holder IDs, version, condition or evidence. Release_hold requires payload.holdId for one current Inventory hold and an actual reason; Fleet maintenance holds require their separate reviewed release. It never certifies physical repair. Server permissions and holds remain authoritative.`,
  input_schema: {
    type: "object" as const,
    properties: {
      checkedOutLongerThanDays: { type: "integer", minimum: 1, maximum: 36500, description: "List current custody older than this many days; report unknownCustodyDates separately. Applies only to list reads, not exact asset or alias lookup." },
      assetId: { type: "string" },
      alias: { ...alias, description: "Read an exact authorized asset by plate, VIN, serial number or asset tag. Supply jurisdiction for plates when known; never guess an identifier." },
      action: { type: "string", enum: ["create", "provisional", "aliases", "checkout", "return", "transfer", "condition", "hold", "release_hold", "merge", "verify-issued"] },
      operationId: { type: "string", format: "uuid" },
      expectedVersion: { type: "integer", minimum: 1 },
      payload: { type: "object", properties: {
        name: { type: "string" }, category: { type: "string" }, legalOwner: { type: "string" },
        manufacturer: { type: "string" }, model: { type: "string" },
        aliases: { type: "array", items: alias }, alias,
        condition: { type: "string", enum: ["new", "good", "fair", "damaged", "missing", "stolen"] },
        note: { type: "string" }, photos: { type: "array", items: { type: "string" } },
        expectedReturnAt: { type: "string" }, holderUserId: { type: "integer" }, toHolderUserId: { type: "integer" },
        holdId: { type: "string", format: "uuid" },
        reason: { type: "string" }, mergedAssetId: { type: "string" },
      }, additionalProperties: false },
    },
    required: tool.mutating ? ["action", "operationId", "payload"] : [],
    additionalProperties: false,
  },
}));

