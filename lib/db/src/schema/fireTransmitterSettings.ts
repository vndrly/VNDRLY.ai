import { pgTable, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Singleton row keyed at id=1. Holds the IRS FIRE transmitter info
// (TCC, EIN, name, address, contact name/email/phone) the 1099 e-file
// generator writes into the T record. Modeled as a one-row table — not
// a per-tenant resource — because every IRS submission VNDRLY makes
// uses the same Transmitter Control Code.
//
// Each value is stored nullable so partially-completed setup works
// (the operator can save "TCC for now, address later" without breaking
// the row); the route that builds a real (non-test) FIRE file
// re-validates that all required fields are populated and the address
// parses into city/state/zip before allowing the download.
//
// This row is the sole source of truth for the T record (Task #826
// removed the legacy `IRS_FIRE_*` env-var fallback): when no row is
// present, real (non-test) FIRE downloads are blocked.
export const fireTransmitterSettingsTable = pgTable(
  "fire_transmitter_settings",
  {
    id: integer("id").primaryKey().notNull(),
    tcc: text("tcc"),
    ein: text("ein"),
    name: text("name"),
    address: text("address"),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedByUserId: integer("updated_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
  },
);

export const insertFireTransmitterSettingsSchema = createInsertSchema(
  fireTransmitterSettingsTable,
).omit({ updatedAt: true });
export type InsertFireTransmitterSettings = z.infer<
  typeof insertFireTransmitterSettingsSchema
>;
export type FireTransmitterSettings =
  typeof fireTransmitterSettingsTable.$inferSelect;
