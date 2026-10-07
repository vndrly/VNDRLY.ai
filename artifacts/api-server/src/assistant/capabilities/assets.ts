import { capabilityTools, type ImplementationACapabilityTool } from "./types";
const alias = { type: "object", properties: { kind: { type: "string", enum: ["vin", "plate", "serial", "asset_tag", "model", "other"] }, value: { type: "string" }, jurisdiction: { type: "string" } }, required: ["kind", "value"], additionalProperties: false };
export const ASSET_CAPABILITY_TOOLS: ImplementationACapabilityTool[] = capabilityTools("asset_custody", "asset lookup, checkout, return, condition, and evidence", "events.subscribe", ["admin", "partner", "vendor", "field_employee"]).map(tool => ({
  ...tool,
  description: `${tool.description} Read the exact asset and current version first. Checkout, return, transfer, and verify-issued require payload.condition as well as expectedVersion. If condition is unknown, ask the user before preparing; never invent it. Writes require exact-value user confirmation. Never guess holder IDs, version, condition or evidence. Release_hold requires payload.holdId for one current Inventory hold and an actual reason; Fleet maintenance holds require their separate reviewed release. It never certifies physical repair. Loss_report requires an actual user report of missing or stolen and a reason; it retains the recorded holder and places a hold, without proving physical loss. Identifier_claim records a serial/identifier collision for platform mediation and never transfers ownership or reveals the other owner. Resolve_identifier_claim uses the saved claim version as expectedVersion and is platform-admin-only and may correct the requester alias; it never changes the other asset. Respond_identifier_claim supplies an actual user explanation only for an awaiting_evidence own-company claim, returning it to mediation; no attachment or verified evidence is claimed. Withdraw_identifier_claim withdraws an open own-company claim. Both require payload.claimId, payload.reason and the exact saved claim version; they never change custody or aliases. Read lastCustody as recorded custody, not live possession. Asset-tag identifiers and Apple tags are not connected live GPS providers. Server permissions and holds remain authoritative.`,
  input_schema: {
    type: "object" as const,
    properties: {
      checkedOutLongerThanDays: { type: "integer", minimum: 1, maximum: 36500, description: "List current custody older than this many days; report unknownCustodyDates separately. Applies only to list reads, not exact asset or alias lookup." },
      assetId: { type: "string" },
      alias: { ...alias, description: "Read an exact authorized asset by plate, VIN, serial number or asset tag. Supply jurisdiction for plates when known; never guess an identifier." },
      action: { type: "string", enum: ["create", "provisional", "aliases", "checkout", "return", "transfer", "condition", "hold", "release_hold", "merge", "verify-issued", "loss_report", "identifier_claim", "respond_identifier_claim", "withdraw_identifier_claim", "resolve_identifier_claim"] },
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
        claimId: { type: "string", format: "uuid" }, decision: { type: "string", enum: ["request_evidence", "reject", "retain_existing", "correct_requester_alias"] }, correctedAlias: alias,
      }, additionalProperties: false },
    },
    required: tool.mutating ? ["action", "operationId", "payload"] : [],
    additionalProperties: false,
  },
}));
ASSET_CAPABILITY_TOOLS.push({ name: "query_asset_transfer_recipients", description: "Read bounded current same-company custody-transfer recipient names for one exact authorized asset. Current holder/manager/supervisor transfer authority is required by the canonical endpoint; this is not a company roster, ownership transfer or physical-handoff proof. Read these choices and current version before preparing transfer.", input_schema: { type: "object", properties: { assetId: { type: "string", format: "uuid" } }, required: ["assetId"], additionalProperties: false }, mutating: false, confirmation: "none", roles: ["admin", "partner", "vendor", "field_employee"], authorityCapability: "events.subscribe" });

ASSET_CAPABILITY_TOOLS.push({ name: "query_asset_identifier_claims", description: "Read only registration-collision claims for an exact authorized own-company asset. No other owner's identity, asset, holder, or location is disclosed. A pending claim does not transfer ownership. Platform mediator review is required.", input_schema: { type: "object", properties: { assetId: { type: "string", format: "uuid" } }, required: ["assetId"], additionalProperties: false }, mutating: false, confirmation: "none", roles: ["admin", "partner", "vendor"], authorityCapability: "events.subscribe" });
ASSET_CAPABILITY_TOOLS.push({ name: "query_asset_identifier_review_queue", description: "Platform-admin-only read of pending identifier claims for explicit human mediation. It does not transfer ownership or expose another owner's holder/location through the claim response.", input_schema: { type: "object", properties: {}, additionalProperties: false }, mutating: false, confirmation: "none", roles: ["admin"], authorityCapability: "events.subscribe" });
