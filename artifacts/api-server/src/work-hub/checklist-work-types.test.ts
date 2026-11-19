import { expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
vi.mock("@workspace/db", () => ({ db: { execute: vi.fn() } }));
import { groupChecklistWorkTypes, readChecklistWorkTypes, requireChecklistWorkType } from "./checklist-work-types";
import { checklistPayload } from "./assistant-payload-schemas";

it("reads only the vendor's selected catalog work types", async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ id: 22, name: "Equipment service", category: "Maintenance" }] });
  expect(await readChecklistWorkTypes({ type: "vendor", id: 1054 }, { execute } as any)).toHaveLength(1);
  const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
  expect(query.sql).toContain("FROM vendor_work_types v JOIN work_types w");
  expect(query.params).toEqual([1054]);
});
it("rejects linking a checklist to a work type outside the company's catalog", async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  await expect(requireChecklistWorkType({ execute } as any, { type: "vendor", id: 1054 }, 999)).rejects.toMatchObject({ status: 403 });
  expect(new PgDialect().sqlToQuery(execute.mock.calls[0][0]).params).toEqual([1054]);
});
it("scopes partner work types to the current partner", async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  await readChecklistWorkTypes({ type: "partner", id: 41 }, { execute } as any);
  const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
  expect(query.sql).toContain("WHERE w.partner_id=");
  expect(query.params).toEqual([41]);
});
it("requires a work type selection and accepts an explicitly unlinked Other checklist", () => {
  const checklist = { name: "Service checks", definition: [{ id: "inspect", label: "Inspect equipment", type: "checkbox" }] };
  expect(checklistPayload.safeParse(checklist).success).toBe(false);
  expect(checklistPayload.safeParse({ ...checklist, workTypeId: 0 }).success).toBe(false);
  expect(checklistPayload.parse({ ...checklist, workTypeId: 22 }).workTypeId).toBe(22);
  expect(checklistPayload.parse({ ...checklist, workTypeId: null }).workTypeId).toBeNull();
});
it("combines the same service across partners and retains every matching work type id", async () => {
  const rows = [{ id: 967676, name: "Gatekeeping", category: "Gate Operations" }, { id: 210, name: "Gatekeeping", category: "Gate Operations" }];
  expect(groupChecklistWorkTypes(rows)).toEqual([{ id: 210, name: "Gatekeeping", category: "Gate Operations", workTypeIds: [210, 967676] }]);
  const execute = vi.fn().mockResolvedValue({ rows });
  expect(await requireChecklistWorkType({ execute } as any, { type: "vendor", id: 1054 }, 967676)).toMatchObject({ id: 210, workTypeIds: [210, 967676] });
});
