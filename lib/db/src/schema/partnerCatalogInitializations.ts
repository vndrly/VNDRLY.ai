import { pgTable, integer, text, timestamp, primaryKey } from "drizzle-orm/pg-core";

// Durable initialization markers intentionally survive removal of selections,
// AFEs and approvals, so migration reruns cannot recreate user-removed data.
export const partnerCatalogInitializationsTable = pgTable("partner_catalog_initializations", {
  kind: text("kind").notNull(),
  partnerId: integer("partner_id").notNull(),
  vendorId: integer("vendor_id").notNull().default(0),
  sourceWorkTypeId: integer("source_work_type_id").notNull(),
  workTypeId: integer("work_type_id").notNull(),
  initializedAt: timestamp("initialized_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  pk: primaryKey({ columns: [table.kind, table.partnerId, table.vendorId, table.sourceWorkTypeId] }),
}));
