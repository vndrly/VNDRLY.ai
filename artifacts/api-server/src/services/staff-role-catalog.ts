import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

const platformRoles = new Set(["gatekeeper", "gate supervisor", "gate attendant", "gate", "driver", "dispatch", "dispatcher", "foreman", "field worker", "field employee", "admin", "administrator"]);
const entry = z.object({ id: z.string().min(1).max(120), label: z.string().trim().min(1).max(80), group: z.string().trim().min(1).max(80), aliases: z.array(z.string().max(80)).max(100).optional() }).strict();
export const catalogInput = z.object({ version: z.number().int().nonnegative(), entries: z.array(entry).min(1).max(250) }).strict().superRefine((value, ctx) => {
  const labels = new Set<string>(), ids = new Set<string>();
  for (const role of value.entries) {
    const label = role.label.toLowerCase();
    if (platformRoles.has(label) || (role.id.startsWith("common:") && platformRoles.has(role.id.slice(7).toLowerCase())) || labels.has(label) || ids.has(role.id)) ctx.addIssue({ code: "custom", message: "Use unique staffing roles; VNDRLY operational roles are managed separately.", path: ["entries"] });
    labels.add(label); ids.add(role.id);
  }
});
export type StaffRoleCatalog = z.infer<typeof catalogInput>;
export class StaffRoleCatalogError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export async function readStaffRoleCatalog(vendorId: number): Promise<StaffRoleCatalog> {
  const result = await db.execute(sql`SELECT staff_role_catalog FROM vendors WHERE id = ${vendorId}`);
  if (!result.rows.length) throw new StaffRoleCatalogError("Company not found", 404);
  return (result.rows[0].staff_role_catalog as StaffRoleCatalog | null) ?? { version: 0, entries: [] };
}
export async function saveStaffRoleCatalog(vendorId: number, input: StaffRoleCatalog): Promise<StaffRoleCatalog> {
  return db.transaction(async tx => {
    const result = await tx.execute(sql`SELECT staff_role_catalog FROM vendors WHERE id = ${vendorId} FOR UPDATE`);
    if (!result.rows.length) throw new StaffRoleCatalogError("Company not found", 404);
    const previous = (result.rows[0].staff_role_catalog as StaffRoleCatalog | null) ?? { version: 0, entries: [] };
    if (previous.version !== input.version) throw new StaffRoleCatalogError("Roles changed in another window. Reload the role list before saving.", 409);
    if (previous.entries.some(old => !input.entries.some(role => role.id === old.id))) throw new StaffRoleCatalogError("Keep existing roles when adding or editing positions.", 400);
    for (const role of input.entries) {
      if (previous.entries.some(old => old.id !== role.id && [old.label, ...(old.aliases ?? [])].some(label => label.toLowerCase() === role.label.toLowerCase()))) throw new StaffRoleCatalogError("That title belongs to another existing role.", 400);
    }
    const entries = input.entries.map(role => {
      const old = previous.entries.find(value => value.id === role.id);
      // Keep old titles recognizable without rewriting any employee or permission record.
      const aliases = [...new Set([...(old?.aliases ?? []), ...(old ? [old.label] : role.id.startsWith("common:") ? [role.id.slice(7)] : [])])].filter(label => label !== role.label);
      return { id: role.id, label: role.label, group: role.group, aliases };
    });
    const next = { version: input.version + 1, entries };
    await tx.execute(sql`UPDATE vendors SET staff_role_catalog = ${JSON.stringify(next)}::jsonb WHERE id = ${vendorId}`);
    return next;
  });
}
