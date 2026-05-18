import { pgTable, text, serial, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const taxRatesTable = pgTable("tax_rates", {
  id: serial("id").primaryKey(),
  state: text("state").notNull().unique(),
  stateName: text("state_name").notNull(),
  rate: numeric("rate", { precision: 6, scale: 4 }).notNull(),
});

export const insertTaxRateSchema = createInsertSchema(taxRatesTable).omit({ id: true });
export type InsertTaxRate = z.infer<typeof insertTaxRateSchema>;
export type TaxRate = typeof taxRatesTable.$inferSelect;
