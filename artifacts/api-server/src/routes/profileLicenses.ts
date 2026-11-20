import type { IRouter } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { db, employeeLicensesTable } from '@workspace/db';
import { ProfileLicenseBody } from '@workspace/api-zod/profile-licenses';

type Access = {
  read: (req: any, res: any, id: number) => Promise<unknown>;
  mutate: (req: any, res: any, id: number) => Promise<{ session: { userId: number; role: string } } | null>;
};
export function registerProfileLicenses(router: IRouter, access: Access) {
  const path = '/field-employees/:employeeId/licenses';
  const validId = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const fields = {id:employeeLicensesTable.id,details:employeeLicensesTable.details};
  const shape = (row: Pick<typeof employeeLicensesTable.$inferSelect,'id'|'details'>) => ({ ...row.details, id: row.id });
  router.get(path, async (req, res) => {
    const id = Number(req.params.employeeId);
    if (!validId(id)) { res.status(400).json({ error: 'Invalid employee' }); return; }
    if (!await access.read(req, res, id)) return;
    const rows = await db.select(fields).from(employeeLicensesTable).where(and(eq(employeeLicensesTable.employeeId, id), isNull(employeeLicensesTable.deletedAt)));
    res.json(rows.map(shape));
  });
  router.post(path, async (req, res) => {
    const id = Number(req.params.employeeId);
    if (!validId(id)) { res.status(400).json({ error: 'Invalid employee' }); return; }
    if (!await access.mutate(req, res, id)) return;
    const parsed = ProfileLicenseBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ message: parsed.error.issues[0]?.message }); return; }
    const [row] = await db.insert(employeeLicensesTable).values({ employeeId: id, details: parsed.data }).returning(fields);
    res.status(201).json(shape(row));
  });
  router.put(`${path}/:licenseId`, async (req, res) => {
    const id = Number(req.params.employeeId), licenseId = Number(req.params.licenseId);
    if (!validId(id) || !validId(licenseId)) { res.status(400).json({ error: 'Invalid record' }); return; }
    if (!await access.mutate(req, res, id)) return;
    const parsed = ProfileLicenseBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ message: parsed.error.issues[0]?.message }); return; }
    const [row] = await db.update(employeeLicensesTable).set({ details: parsed.data })
      .where(and(eq(employeeLicensesTable.id, licenseId), eq(employeeLicensesTable.employeeId, id), isNull(employeeLicensesTable.deletedAt))).returning(fields);
    if (!row) { res.status(404).json({ error: 'Record not found' }); return; }
    res.json(shape(row));
  });
  router.delete(`${path}/:licenseId`, async (req, res) => {
    const id = Number(req.params.employeeId), licenseId = Number(req.params.licenseId);
    if (!validId(id) || !validId(licenseId)) { res.status(400).json({ error: 'Invalid record' }); return; }
    if (!await access.mutate(req, res, id)) return;
    const [row] = await db.update(employeeLicensesTable).set({ deletedAt: new Date() })
      .where(and(eq(employeeLicensesTable.id, licenseId), eq(employeeLicensesTable.employeeId, id), isNull(employeeLicensesTable.deletedAt))).returning({ id: employeeLicensesTable.id });
    if (!row) { res.status(404).json({ error: 'Record not found' }); return; }
    res.status(204).end();
  });
}
