import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import { EmployeeSubscriptionFieldsSchema, type EmployeeSubscription, type EmployeeSubscriptionFields, type SubscriptionEmployee } from "@workspace/api-zod";
import { isVendorOfficeStaff } from "../lib/vendor-people-management";
import type { SessionPayload } from "../lib/session";

// Company expense/assignment records, separate from VNDRLY access entitlements.
const KIND = "employee_subscription";
export type SubscriptionCompany = { type: "vendor" | "partner"; id: number };
export class EmployeeSubscriptionError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
export function subscriptionCompany(session: SessionPayload): SubscriptionCompany {
  if (!session.userId) throw new EmployeeSubscriptionError("subscription.sign_in_required", 401, "Sign in to view subscriptions.");
  if (session.vendorId && !session.partnerId) return { type: "vendor", id: session.vendorId };
  if (session.partnerId && !session.vendorId) return { type: "partner", id: session.partnerId };
  throw new EmployeeSubscriptionError("subscription.company_required", 403, "Choose a company to manage its subscriptions.");
}
export async function canManageEmployeeSubscriptions(session: SessionPayload, owner = subscriptionCompany(session)) {
  if (session.managedSubcontractor) return false;
  if (owner.type === "vendor") return isVendorOfficeStaff({ ...session, userId: session.userId!, role: session.role!, vendorId: session.vendorId ?? null }, owner.id);
  return session.role === "partner" && session.partnerId === owner.id && session.membershipRole === "admin";
}
export async function subscriptionEmployees(owner: SubscriptionCompany, connection: Pick<PoolClient, "query"> = pool): Promise<SubscriptionEmployee[]> {
  if (owner.type === "vendor") {
    const { rows } = await connection.query(`
      SELECT 'person:'||p.id AS key, p.user_id AS "userId", trim(p.first_name||' '||p.last_name) AS name, p.email
      FROM vendor_people p WHERE p.vendor_id=$1 AND p.is_active AND p.deleted_at IS NULL
      UNION ALL
      SELECT 'account:'||u.id, u.id, u.display_name, u.email
      FROM user_org_memberships m JOIN users u ON u.id=m.user_id
      WHERE m.org_type='vendor' AND m.vendor_id=$1 AND u.suspended_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM vendor_people p WHERE p.vendor_id=$1 AND p.user_id=u.id AND p.is_active AND p.deleted_at IS NULL)
      UNION ALL
      SELECT 'account:'||u.id, u.id, u.display_name, u.email
      FROM managed_subcontractor_worker_sponsorships s JOIN users u ON u.id=s.worker_user_id
      WHERE s.sponsor_vendor_id=$1 AND s.status='active' AND u.suspended_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM vendor_people p WHERE p.vendor_id=$1 AND p.user_id=u.id AND p.is_active AND p.deleted_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM user_org_memberships m WHERE m.org_type='vendor' AND m.vendor_id=$1 AND m.user_id=u.id)
      ORDER BY name, key`, [owner.id]);
    return rows;
  }
  return (await connection.query(`SELECT 'account:'||u.id AS key,u.id AS "userId",u.display_name AS name,u.email
    FROM user_org_memberships m JOIN users u ON u.id=m.user_id
    WHERE m.org_type='partner' AND m.partner_id=$1 AND u.suspended_at IS NULL ORDER BY u.display_name`, [owner.id])).rows;
}
async function companyName(owner: SubscriptionCompany, connection: Pick<PoolClient, "query"> = pool): Promise<string> {
  const table = owner.type === "vendor" ? "vendors" : "partners";
  return (await connection.query(`SELECT name FROM ${table} WHERE id=$1`, [owner.id])).rows[0]?.name ?? "";
}
function project(row: { id: string; data: Record<string, unknown>; created_at: Date; updated_at: Date }, name: string): EmployeeSubscription {
  return { ...EmployeeSubscriptionFieldsSchema.parse(row.data.fields),
    id: row.id, version: Number(row.data.version), employeeName: String(row.data.employeeName),
    workerUserId: typeof row.data.workerUserId === "number" ? row.data.workerUserId : null,
    companyName: name, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
export async function readEmployeeSubscriptions(session: SessionPayload) {
  const owner = subscriptionCompany(session), canManage = await canManageEmployeeSubscriptions(session, owner);
  const name = await companyName(owner), employees = await subscriptionEmployees(owner);
  const ownKeys = new Set(employees.filter(row => row.userId === session.userId).map(row => row.key));
  const rows = await pool.query(`SELECT id,data,created_at,updated_at FROM work_hub_finance_records
    WHERE org_type=$1 AND org_id=$2 AND kind=$3 ORDER BY created_at DESC,id`, [owner.type, owner.id, KIND]);
  return { canManage, companyName: name, employees: canManage ? employees : [],
    subscriptions: rows.rows.map(row => project(row, name)).filter(row => canManage || ownKeys.has(row.employeeKey)) };
}
export async function readMyEmployeeSubscriptions(userId: number) {
  // Resolve the employee/account link live, including assignments made before first login.
  const rows = await pool.query(`SELECT r.id,r.data,r.created_at,r.updated_at,coalesce(v.name,p.name,'') AS company_name
    FROM work_hub_finance_records r
    LEFT JOIN vendors v ON r.org_type='vendor' AND v.id=r.org_id
    LEFT JOIN partners p ON r.org_type='partner' AND p.id=r.org_id
    WHERE r.kind=$1 AND (r.data->'fields'->>'employeeKey'='account:'||$2 OR
      (r.org_type='vendor' AND EXISTS(SELECT 1 FROM vendor_people e WHERE e.vendor_id=r.org_id AND e.user_id=$2::int
        AND r.data->'fields'->>'employeeKey'='person:'||e.id AND e.deleted_at IS NULL))
    ) ORDER BY r.created_at DESC,r.id`, [KIND, String(userId)]);
  return { subscriptions: rows.rows.map(row => project(row, row.company_name)) };
}
export async function saveEmployeeSubscription(session: SessionPayload, fields: EmployeeSubscriptionFields,
  command: { operationId: string } | { id: string; expectedVersion: number }) {
  const owner = subscriptionCompany(session);
  if (!await canManageEmployeeSubscriptions(session, owner)) throw new EmployeeSubscriptionError("subscription.employee_management_required", 403, "Employee management access is required.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`employee-subscriptions:${owner.type}:${owner.id}`]);
    const employee = (await subscriptionEmployees(owner, client)).find(person => person.key === fields.employeeKey);
    if (!employee) throw new EmployeeSubscriptionError("subscription.employee_not_found", 404, "Choose an employee from this company.");
    const isNew = "operationId" in command;
    const found = await client.query(`SELECT id,data,created_at,updated_at FROM work_hub_finance_records
      WHERE org_type=$1 AND org_id=$2 AND kind=$3 AND ${isNew ? "record_key" : "id::text"}=$4 FOR UPDATE`,
      [owner.type, owner.id, KIND, isNew ? command.operationId : command.id]);
    const previous = found.rows[0];
    if (isNew && previous) {
      if (!isDeepStrictEqual(previous.data.fields, fields)) throw new EmployeeSubscriptionError("subscription.operation_conflict", 409, "This save already recorded different subscription details.");
      const saved = project(previous, await companyName(owner, client));
      await client.query("COMMIT"); return saved;
    }
    if (!isNew && (!previous || previous.data.version !== command.expectedVersion)) throw new EmployeeSubscriptionError("subscription.version_conflict", 409, "This subscription changed. Refresh and try again.");
    const id = previous?.id ?? randomUUID(), version = (previous?.data.version ?? 0) + 1;
    const data = { fields, version, employeeName: employee.name, workerUserId: employee.userId };
    const saved = isNew
      ? await client.query(`INSERT INTO work_hub_finance_records(id,org_type,org_id,kind,record_key,data,created_by)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id,data,created_at,updated_at`, [id, owner.type, owner.id, KIND, command.operationId, JSON.stringify(data), session.userId])
      : await client.query(`UPDATE work_hub_finance_records SET data=$1::jsonb,updated_at=now()
          WHERE id=$2 AND org_type=$3 AND org_id=$4 AND kind=$5 RETURNING id,data,created_at,updated_at`, [JSON.stringify(data), id, owner.type, owner.id, KIND]);
    await client.query(`INSERT INTO work_hub_audit_log(actor_user_id,owner_org_type,owner_org_id,action,subject_type,subject_id,prior_version,new_version,source,metadata)
      VALUES($1,$2,$3,$4,'employee_subscription',$5,$6,$7,'web',$8::jsonb)`,
      [session.userId, owner.type, owner.id, isNew ? "subscription.created" : "subscription.updated", id, previous?.data.version ?? null, version, JSON.stringify({ employeeKey: fields.employeeKey, status: fields.status })]);
    const result = project(saved.rows[0], await companyName(owner, client));
    await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
