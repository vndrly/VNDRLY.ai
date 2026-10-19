import type { Anthropic } from "@workspace/integrations-anthropic-ai/sdk";

const id = { type: "integer", minimum: 1 };
const text = { type: "string" };
const nullableText = { type: ["string", "null"] };
const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});
const vendor = {
  vendorId: {
    ...id,
    description:
      "Administrators must select a vendor; other accounts use their active vendor.",
  },
};
const partner = {
  partnerId: {
    ...id,
    description:
      "Administrators must select a partner; other accounts use their active partner.",
  },
};
const page = {
  limit: { ...id, maximum: 100 },
  offset: { type: "integer", minimum: 0 },
};
const comparison = {
  ...partner,
  workTypeId: id,
  siteId: id,
  requestedCapacity: id,
  sort: {
    type: "string",
    enum: [
      "recommended",
      "safety",
      "rating",
      "history",
      "onTime",
      "distance",
      "price",
      "availability",
      "priorExperience",
    ],
  },
  ...page,
};
const capability = object(
  {
    name: text,
    description: nullableText,
    defaultUnit: nullableText,
    defaultRateCard: {
      anyOf: [
        object(
          {
            unitPrice: { type: "number", minimum: 0 },
            unit: text,
            currency: text,
          },
          ["unitPrice", "unit"],
        ),
        { type: "null" },
      ],
    },
    capacity: id,
    qualifications: { type: ["object", "null"] },
    evidence: { type: ["object", "null"] },
    active: { type: "boolean" },
  },
  ["name"],
);
const rate = object(
  {
    vendorCapabilityId: id,
    workTypeId: id,
    unitPrice: { type: "number", minimum: 0 },
    unit: text,
    currency: text,
    rateComponents: { type: ["object", "null"] },
    notes: nullableText,
    commercialConditions: nullableText,
    availability: {
      anyOf: [
        object({ available: { type: "boolean" } }, ["available"]),
        { type: "null" },
      ],
    },
    capacity: id,
    active: { type: "boolean" },
  },
  ["vendorCapabilityId", "workTypeId", "unitPrice", "unit"],
);
const job = object(
  {
    partnerId: id,
    workTypeId: id,
    vendorId: id,
    vendorCapabilityId: id,
    vendorPartnerServiceOfferId: id,
    siteLocationId: id,
    scope: text,
    requestedStartAt: text,
    requestedEndAt: text,
    crewCount: id,
    afeCode: text,
    poNumber: text,
    attachmentUrls: { type: "array", items: text },
    expiresAt: text,
  },
  [
    "partnerId",
    "workTypeId",
    "vendorId",
    "vendorCapabilityId",
    "vendorPartnerServiceOfferId",
    "siteLocationId",
    "scope",
    "requestedStartAt",
    "requestedEndAt",
    "crewCount",
    "attachmentUrls",
    "expiresAt",
  ],
);
type Role = "admin" | "partner" | "vendor";
type Entry = { tool: Anthropic.Tool; roles: Role[]; mutating: boolean };
const entry = (
  name: string,
  roles: Role[],
  description: string,
  schema: Anthropic.Tool["input_schema"],
  mutating = false,
): Entry => ({
  tool: { name, description, input_schema: schema },
  roles,
  mutating,
});
const office: Role[] = ["admin", "partner", "vendor"];
const vendors: Role[] = ["admin", "vendor"];
const partners: Role[] = ["admin", "partner"];
const entries: Entry[] = [
  entry(
    "search_marketplace_services",
    office,
    "Search saved semantic marketplace matches. Vendors see approved partner demand and their own terms only. Partners must select a partner work type and site to compare vendors. Optional query filters wording on the returned page; it never creates a semantic mapping.",
    object({ ...vendor, ...comparison, query: text }),
  ),
  entry(
    "query_marketplace_demand",
    vendors,
    "Read matching demand across all partner catalogs using stored active mappings. Returns public wording, state-level locations, approximate demand and only this vendor's own rates and eligibility; never competitor rates or partner budgets.",
    object({ ...vendor, ...page }),
  ),
  entry(
    "query_marketplace_capabilities",
    vendors,
    "Read the active vendor's saved capabilities, mapping status and explanation. Pending mappings are not commercial matches.",
    object(vendor),
  ),
  entry(
    "compare_marketplace_vendors",
    partners,
    "Compare vendors offering terms to the selected partner work type at the saved site. Eligibility and ranking come from VNDRLY. Explain Out of Service Area without offering to bypass it; never silently choose a winner.",
    object(comparison, ["workTypeId", "siteId"]),
  ),
  entry(
    "explain_marketplace_match",
    office,
    "Explain a saved mapping. Vendors select their capability ID; partners supply workTypeId, siteId and capabilityId for an authorized comparison. Cite the stored canonical service and explanation; never invent confidence or compliance.",
    object({ ...vendor, ...comparison, capabilityId: id }, ["capabilityId"]),
  ),
  entry(
    "query_marketplace_job_offers",
    office,
    "Read authorized job offers or an exact offer ID. An accepted offer's createdTicketId is the canonical created ticket; draft or sent offers do not create tickets.",
    object({ ...vendor, ...partner, offerId: id }),
  ),
  entry(
    "prepare_marketplace_capability",
    vendors,
    "Preview a proposed capability description. This classifier preview is provisional, saves nothing, and does not establish a stored commercial mapping. Show the result before offering to save.",
    object(
      {
        ...vendor,
        payload: object({ name: text, description: nullableText }, ["name"]),
      },
      ["payload"],
    ),
  ),
  entry(
    "confirm_marketplace_capability",
    vendors,
    "Create or update a vendor capability only after exact-action confirmation. capabilityId selects an update; omit it to create. Classification and canonical readback are server-owned; model confidence or compliance is ignored.",
    object({ ...vendor, capabilityId: id, payload: capability }, ["payload"]),
    true,
  ),
  entry(
    "confirm_marketplace_service_area",
    vendors,
    "Save an exact radius after confirmation, using the vendor's saved verified service base. Never supply coordinates. A null vendorCapabilityId selects the company default.",
    object(
      {
        ...vendor,
        payload: object(
          {
            vendorCapabilityId: { type: ["integer", "null"], minimum: 1 },
            radiusMiles: {
              type: "number",
              exclusiveMinimum: 0,
              maximum: 20000,
            },
          },
          ["radiusMiles"],
        ),
      },
      ["payload"],
    ),
    true,
  ),
  entry(
    "confirm_marketplace_rate",
    vendors,
    "Save this vendor's exact partner-specific rate after confirmation. Read the matching demand first. The server verifies active stored mappings and derives the partner; no competing rates are available.",
    object({ ...vendor, payload: rate }, ["payload"]),
    true,
  ),
  entry(
    "confirm_marketplace_job_offer",
    partners,
    "Save an exact job-offer draft after confirmation. Rates, mapping and eligibility come from saved records. A draft does not send the offer or create a ticket; read back the draft before proposing send.",
    object({ payload: job }, ["payload"]),
    true,
  ),
  entry(
    "confirm_marketplace_job_offer_action",
    office,
    "After reading the exact offer, confirm send/review/withdraw/decline/accept for its current version. Partner sends or withdraws; vendor reviews, accepts or declines. Acceptance rechecks eligibility and creates exactly one ticket. Report only the canonical result and ticketId.",
    object(
      {
        action: {
          type: "string",
          enum: ["send", "review", "withdraw", "decline", "accept"],
        },
        offerId: id,
        version: id,
      },
      ["action", "offerId", "version"],
    ),
    true,
  ),
];
export const MARKETPLACE_TOOLS = entries.map((entry) => entry.tool);
export const MARKETPLACE_TOOL_METADATA = Object.fromEntries(
  entries.map(({ tool, ...metadata }) => [tool.name, metadata]),
);
export const MARKETPLACE_READ_TOOL_NAMES = [
  "search_marketplace_services",
  "query_marketplace_demand",
  "query_marketplace_capabilities",
  "compare_marketplace_vendors",
  "explain_marketplace_match",
  "query_marketplace_job_offers",
  "prepare_marketplace_capability",
] as const;
export const MARKETPLACE_WRITE_TOOL_NAMES = [
  "confirm_marketplace_capability",
  "confirm_marketplace_service_area",
  "confirm_marketplace_rate",
  "confirm_marketplace_job_offer",
  "confirm_marketplace_job_offer_action",
] as const;
export const isMarketplaceReadTool = (
  name: string,
): name is (typeof MARKETPLACE_READ_TOOL_NAMES)[number] =>
  (MARKETPLACE_READ_TOOL_NAMES as readonly string[]).includes(name);
export const isMarketplaceTool = (name: string) =>
  Object.hasOwn(MARKETPLACE_TOOL_METADATA, name);

/** Discard authority claims before approval fingerprints are made. Domain validators remain authoritative. */
export function sanitizeMarketplaceInput(
  name: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const schema = MARKETPLACE_TOOLS.find(
    (tool) => tool.name === name,
  )?.input_schema;
  if (!schema) return input;
  const properties = (schema.properties ?? {}) as Record<string, unknown>;
  const result = Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) =>
        Object.hasOwn(properties, key) && value !== undefined && value !== null,
    ),
  );
  if (
    result.payload &&
    typeof result.payload === "object" &&
    !Array.isArray(result.payload)
  ) {
    const fields =
      (properties.payload as { properties?: Record<string, unknown> })
        ?.properties ?? {};
    result.payload = Object.fromEntries(
      Object.entries(result.payload).filter(([key]) =>
        Object.hasOwn(fields, key),
      ),
    );
  }
  return result;
}
