import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { WorkHubOwner } from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { validateAssistantSession } from "../assistant/chatgpt-grant-store";
import { WorkHubAccessError } from "./context-access";

export function canManageTaskAssignments(session: SessionPayload) {
  return !session.managedSubcontractor && (session.role === "admin" || session.membershipRole === "admin" || ["office", "both"].includes(session.vendorRole ?? ""));
}
export async function currentTaskAssignmentSession(session: SessionPayload) {
  try { return await validateAssistantSession(session); }
  catch { throw new WorkHubAccessError("forbidden"); }
}
/** Current company members of every role, including admins without an employee row. */
export async function taskAssignmentPeople(owner: WorkHubOwner) {
  const result = await db.execute(sql`SELECT DISTINCT u.id AS "userId",u.display_name AS name,m.role AS "membershipRole",p.vendor_role AS "vendorRole"
    FROM user_org_memberships m JOIN users u ON u.id=m.user_id AND u.suspended_at IS NULL
    LEFT JOIN vendor_people p ON p.id=m.vendor_people_id AND p.user_id=u.id AND p.vendor_id=m.vendor_id
    WHERE m.org_type=${owner.type} AND (${owner.type}='vendor' AND m.vendor_id=${owner.id} OR ${owner.type}='partner' AND m.partner_id=${owner.id})
    AND (${owner.type}='partner' OR m.role='admin' OR (p.is_active=true AND p.deleted_at IS NULL)) ORDER BY u.display_name,u.id`);
  return result.rows as { userId: number; name: string; membershipRole: string; vendorRole: string | null }[];
}
