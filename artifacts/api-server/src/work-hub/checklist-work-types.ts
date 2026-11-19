import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { WorkHubOwner } from "@workspace/api-zod";
import { WorkHubAccessError } from "./context-access";

type Reader = Pick<typeof db, "execute">;
type CatalogWorkType = { id: number; name: string; category: string };
export type ChecklistWorkType = CatalogWorkType & { workTypeIds: number[] };

export function groupChecklistWorkTypes(rows: CatalogWorkType[]): ChecklistWorkType[] {
  const grouped = new Map<string, ChecklistWorkType>();
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    const key = row.name.trim().toLocaleLowerCase();
    const existing = grouped.get(key);
    if (existing) existing.workTypeIds.push(row.id);
    else grouped.set(key, { ...row, workTypeIds: [row.id] });
  }
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function readChecklistWorkTypes(owner: WorkHubOwner, reader: Reader = db) {
  const result = owner.type === "vendor"
    ? await reader.execute(sql`SELECT w.id,w.name,w.category FROM vendor_work_types v JOIN work_types w ON w.id=v.work_type_id WHERE v.vendor_id=${owner.id} ORDER BY w.name,w.id`)
    : await reader.execute(sql`SELECT w.id,w.name,w.category FROM work_types w WHERE w.partner_id=${owner.id} ORDER BY w.name,w.id`);
  return groupChecklistWorkTypes(result.rows as CatalogWorkType[]);
}

export async function requireChecklistWorkType(reader: Reader, owner: WorkHubOwner, workTypeId: number) {
  const workType = (await readChecklistWorkTypes(owner, reader)).find(row => row.workTypeIds.includes(workTypeId));
  if (!workType) throw new WorkHubAccessError("forbidden");
  return workType;
}
