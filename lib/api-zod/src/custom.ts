import { z as zod } from "zod/v4";
import {
  INVOICE_LINE_TYPES,
  INVOICE_LINE_INCOME_CATEGORIES,
} from "@workspace/db/schema";

// Per-(vendor, partner) override map from invoice line_type → 1099 income
// category. Validated against the canonical INVOICE_LINE_TYPES (key) and
// INVOICE_LINE_INCOME_CATEGORIES (value) tuples that drive the invoice
// generator and the `invoice_lines.income_category` column. A typo or stale
// enum value would silently flow through invoice regeneration and end up
// persisted on every line — so we reject unknown keys/values at the API
// boundary.
//
// Shape notes:
//  - `partialRecord` keeps the typed key validation while making each entry
//    optional, so a caller can override one line type and let the rest fall
//    back to the engine default. (`zod.record` with an enum key is exhaustive
//    in zod v4 and would force every key to be present, which is the wrong
//    contract here.)
//  - Empty object {} is valid and means "clear all overrides".
//  - Explicit `null` is valid and means "clear the column entirely".
export const IncomeCategoryOverridesSchema = zod
  .partialRecord(
    zod.enum(INVOICE_LINE_TYPES),
    zod.enum(INVOICE_LINE_INCOME_CATEGORIES),
  )
  .nullable();
export type IncomeCategoryOverridesInput = zod.infer<
  typeof IncomeCategoryOverridesSchema
>;

// Late-fee rule discriminated union. Mirrors `LateFeeRule` in
// `lib/db/src/schema/invoices.ts` so the wire shape, the column type, and the
// invoice-aging worker that consumes it never drift. Stored on both
// `vendor_partner_billing_settings.late_fee_rule` (the per-(vendor, partner)
// default) and on `invoices.late_fee_rule` (the per-invoice override snapshot
// the generator captured at create time and the admin can patch later).
//
// Shape notes:
//  - `flat`     → fixed dollar amount applied once per invoice after
//                 `afterDays` past the due date.
//  - `percent`  → percentage of the invoice total applied once after the
//                 same threshold. `rate` is a string like "1.50" meaning
//                 1.50% (NOT 0.015) so it round-trips with the plain-text
//                 numeric inputs the admin UI uses.
//  - `none`     → no late fee. Equivalent to a missing column on the row;
//                 stored explicitly so admins can override a per-vendor
//                 default of {kind:"flat", ...} with "none" on a single
//                 invoice without nulling the column.
//  - `afterDays` is bounded ≤ 365 to match the aging worker's
//                 MAX_THRESHOLD_DAYS, so a malformed payload can't widen
//                 the worker's scan window past one year.
export const LateFeeRuleSchema = zod.discriminatedUnion("kind", [
  zod.object({
    kind: zod.literal("flat"),
    amount: zod.string().regex(/^\d+(\.\d{1,2})?$/),
    afterDays: zod.number().int().min(0).max(365),
  }),
  zod.object({
    kind: zod.literal("percent"),
    rate: zod.string().regex(/^\d+(\.\d{1,4})?$/),
    afterDays: zod.number().int().min(0).max(365),
    compounding: zod.enum(["none", "monthly"]).optional(),
  }),
  zod.object({ kind: zod.literal("none") }),
]);
export type LateFeeRuleInput = zod.infer<typeof LateFeeRuleSchema>;

// Body for `PUT /api/invoices/vendor-partner-billing-settings`. Shared so the
// web admin UI and any future mobile/admin client validate the same contract
// the server enforces — particularly the 1099 override map values.
export const UpdateVendorPartnerBillingSettingsBody = zod.object({
  vendorId: zod.coerce.number().int(),
  partnerId: zod.coerce.number().int(),
  cadence: zod.enum(["per_ticket", "weekly", "monthly"]).optional(),
  paymentTermsDays: zod.number().int().min(0).max(365).optional(),
  remitToAddress: zod.string().nullable().optional(),
  remitToName: zod.string().nullable().optional(),
  mileageAutoSuggest: zod.boolean().optional(),
  mileageRate: zod
    .string()
    .regex(/^-?\d+(\.\d{1,4})?$/)
    .nullable()
    .optional(),
  overtimeMultiplier: zod
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
  defaultIncomeCategoryOverrides: IncomeCategoryOverridesSchema.optional(),
  // Per-(vendor, partner) late-fee default. `null` clears the rule entirely
  // (no late fee), an explicit `{kind:"none"}` is also valid, and either of
  // {flat,percent} stores the policy that the aging worker will read when an
  // invoice flips to overdue. Omitted means "no change".
  lateFeeRule: LateFeeRuleSchema.nullable().optional(),
});
export type UpdateVendorPartnerBillingSettingsInput = zod.infer<
  typeof UpdateVendorPartnerBillingSettingsBody
>;

// Body for `PATCH /api/invoices/:id/late-fee-rule`. Lets admins (and the
// owning vendor) override the late-fee policy for a single invoice without
// touching the per-(vendor, partner) default. `null` clears the override and
// falls back to the billing-settings default at scan time.
export const UpdateInvoiceLateFeeRuleBody = zod.object({
  lateFeeRule: LateFeeRuleSchema.nullable(),
});
export type UpdateInvoiceLateFeeRuleInput = zod.infer<
  typeof UpdateInvoiceLateFeeRuleBody
>;

// `ListPartnerContactsParams` / `ListPartnerContactsResponse` /
// `ListPartnerContactsResponseItem` are now generated from
// `lib/api-spec/openapi.yaml` (see `generated/api.ts`). The hand-written
// versions used to live here before the endpoint was documented in the
// OpenAPI spec; re-exporting from a single source keeps the server
// validators and the web client wire-types in lockstep. The generated
// `PartnerContact` schema already includes the optional `deletedAt` /
// `deletedBy` fields needed for the admin restore-deleted-contact flow.
export const CreatePartnerContactParams = zod.object({
  partnerId: zod.coerce.number(),
});
export const CreatePartnerContactBody = zod.object({
  jobTitle: zod.string(),
  name: zod.string(),
  email: zod.string(),
  phone: zod.string().nullish(),
  roles: zod.array(zod.string()).optional(),
  photoUrl: zod.string().nullish(),
});
export const UpdatePartnerContactParams = zod.object({
  partnerId: zod.coerce.number(),
  contactId: zod.coerce.number(),
});
export const UpdatePartnerContactBody = zod.object({
  jobTitle: zod.string().optional(),
  name: zod.string().optional(),
  email: zod.string().optional(),
  phone: zod.string().nullish(),
  roles: zod.array(zod.string()).optional(),
  photoUrl: zod.string().nullish(),
});
export const DeletePartnerContactParams = zod.object({
  partnerId: zod.coerce.number(),
  contactId: zod.coerce.number(),
});
export const ListPartnerNotesParams = zod.object({
  partnerId: zod.coerce.number(),
});
export const ListPartnerNotesResponseItem = zod.object({
  id: zod.number(),
  partnerId: zod.number(),
  content: zod.string(),
  createdAt: zod.coerce.date(),
});
export const ListPartnerNotesResponse = zod.array(ListPartnerNotesResponseItem);
export const CreatePartnerNoteParams = zod.object({
  partnerId: zod.coerce.number(),
});
export const CreatePartnerNoteBody = zod.object({
  content: zod.string(),
});
export const DeletePartnerNoteParams = zod.object({
  partnerId: zod.coerce.number(),
  noteId: zod.coerce.number(),
});
// `ListVendorContactsParams` / `ListVendorContactsResponse` /
// `ListVendorContactsResponseItem` are now generated from
// `lib/api-spec/openapi.yaml` (see `generated/api.ts`).
export const CreateVendorContactParams = zod.object({
  vendorId: zod.coerce.number(),
});
export const CreateVendorContactBody = zod.object({
  jobTitle: zod.string().nullish(),
  firstName: zod.string(),
  lastName: zod.string(),
  email: zod.string(),
  phone: zod.string().nullish(),
  vendorRole: zod.string().optional(),
  pecCertification: zod.boolean().optional(),
  pecExpirationDate: zod.string().nullish(),
  photoUrl: zod.string().nullish(),
  roles: zod.array(zod.string()).optional(),
});
export const UpdateVendorContactParams = zod.object({
  vendorId: zod.coerce.number(),
  contactId: zod.coerce.number(),
});
export const UpdateVendorContactBody = zod.object({
  jobTitle: zod.string().optional(),
  firstName: zod.string().optional(),
  lastName: zod.string().optional(),
  email: zod.string().optional(),
  phone: zod.string().nullish(),
  vendorRole: zod.string().optional(),
  pecCertification: zod.boolean().optional(),
  pecExpirationDate: zod.string().nullish(),
  photoUrl: zod.string().nullish(),
  roles: zod.array(zod.string()).optional(),
});
export const DeleteVendorContactParams = zod.object({
  vendorId: zod.coerce.number(),
  contactId: zod.coerce.number(),
});
export const ListVendorNotesParams = zod.object({
  vendorId: zod.coerce.number(),
});
export const ListVendorNotesResponseItem = zod.object({
  id: zod.number(),
  vendorId: zod.number(),
  content: zod.string(),
  createdAt: zod.coerce.date(),
});
export const ListVendorNotesResponse = zod.array(ListVendorNotesResponseItem);
export const CreateVendorNoteParams = zod.object({
  vendorId: zod.coerce.number(),
});
export const CreateVendorNoteBody = zod.object({
  content: zod.string(),
});
export const DeleteVendorNoteParams = zod.object({
  vendorId: zod.coerce.number(),
  noteId: zod.coerce.number(),
});
export const UpdateFieldEmployeeParams = zod.object({
  id: zod.coerce.number(),
});
export const UpdateFieldEmployeeBody = zod.object({
  vendorRole: zod.string().optional(),
  jobTitle: zod.string().nullish(),
  firstName: zod.string().optional(),
  lastName: zod.string().optional(),
  email: zod.string().optional(),
  phone: zod.string().nullish(),
  isActive: zod.boolean().optional(),
  pecCertification: zod.boolean().optional(),
  pecExpirationDate: zod.string().nullish(),
  photoUrl: zod.string().nullish(),
  // Task #8: lets admins/vendors clear a field employee's mobile-uploaded
  // selfie from the web. Sending `null` removes the stored object path so
  // the avatar falls back to the placeholder in both web and mobile.
  profilePhotoPath: zod.string().nullish(),
  roles: zod.array(zod.string()).optional(),
  // Task #831: lets admins/vendors set or clear the field employee's
  // preferred UI/assistant language from the field-employee detail page.
  // Persists to `vendor_people.preferred_language`; the route handler
  // mirrors the value into `users.preferred_language` when a linked
  // login exists so the next assistant turn keys off the same value.
  // Accepts "en", "es", or `null` (clear → "let the user choose").
  preferredLanguage: zod.enum(["en", "es"]).nullish(),
});
export const ListFieldEmployeeNotesParams = zod.object({
  employeeId: zod.coerce.number(),
});
export const ListFieldEmployeeNotesResponseItem = zod.object({
  id: zod.number(),
  employeeId: zod.number(),
  content: zod.string(),
  createdAt: zod.coerce.date(),
});
export const ListFieldEmployeeNotesResponse = zod.array(ListFieldEmployeeNotesResponseItem);
export const CreateFieldEmployeeNoteParams = zod.object({
  employeeId: zod.coerce.number(),
});
export const CreateFieldEmployeeNoteBody = zod.object({
  content: zod.string(),
});
export const DeleteFieldEmployeeNoteParams = zod.object({
  employeeId: zod.coerce.number(),
  noteId: zod.coerce.number(),
});
export const DeleteSiteLocationParams = zod.object({
  id: zod.coerce.number(),
});
export const VendorRatingParams = zod.object({
  vendorId: zod.coerce.number(),
});
export const UpsertVendorRatingBody = zod.object({
  rating: zod.number().int().min(1).max(5),
  review: zod.string().nullish(),
  // When provided, the rating is keyed to this ticket and a NEW row is
  // inserted (or that ticket's row is updated). When omitted, the
  // legacy standalone "Your Rating" upsert keyed by (vendor, partner)
  // is used. Per-ticket ratings are what feed the running average on
  // the vendor's Ratings & Reviews card.
  ticketId: zod.number().int().positive().nullish(),
});
export const VendorRatingItem = zod.object({
  id: zod.number(),
  vendorId: zod.number(),
  partnerId: zod.number(),
  partnerName: zod.string(),
  userId: zod.number(),
  userDisplayName: zod.string(),
  ticketId: zod.number().nullable(),
  rating: zod.number(),
  review: zod.string().nullable(),
  createdAt: zod.coerce.date(),
  updatedAt: zod.coerce.date(),
});
export const GetVendorRatingsResponse = zod.object({
  average: zod.number().nullable(),
  count: zod.number(),
  myRating: VendorRatingItem.nullable(),
  items: zod.array(VendorRatingItem),
});
