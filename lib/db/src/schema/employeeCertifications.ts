import { pgTable, text, serial, timestamp, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { fieldEmployeesTable } from "./vendorPeople";
import { usersTable } from "./users";

export const employeeCertificationsTable = pgTable("employee_certifications", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => fieldEmployeesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  issuer: text("issuer"),
  certNumber: text("cert_number"),
  issuedDate: date("issued_date"),
  expirationDate: date("expiration_date"),
  documentUrl: text("document_url"),
  documentPath: text("document_path"),
  vendorVerifiedAt: timestamp("vendor_verified_at", { withTimezone: true }),
  vendorVerifiedByUserId: integer("vendor_verified_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by"),
});

export const insertEmployeeCertificationSchema = createInsertSchema(employeeCertificationsTable).omit({
  id: true,
  createdAt: true,
  deletedAt: true,
  deletedBy: true,
});
export type InsertEmployeeCertification = z.infer<typeof insertEmployeeCertificationSchema>;
export type EmployeeCertification = typeof employeeCertificationsTable.$inferSelect;
