import { eq } from "drizzle-orm";
import { db, fieldEmployeesTable } from "@workspace/db";

export async function markEmployeeProfilePendingReview(employeeId: number): Promise<void> {
  await db
    .update(fieldEmployeesTable)
    .set({ profilePendingReviewAt: new Date() })
    .where(eq(fieldEmployeesTable.id, employeeId));
}

export async function clearEmployeeProfilePendingReview(employeeId: number): Promise<void> {
  await db
    .update(fieldEmployeesTable)
    .set({ profilePendingReviewAt: null })
    .where(eq(fieldEmployeesTable.id, employeeId));
}

export function isVendorOrAdminSession(session: { role: string }): boolean {
  return session.role === "admin" || session.role === "vendor";
}

export function isFieldEmployeeSelfSession(
  session: { role: string; userId: number },
  employeeId: number,
  selfId: number | null,
): boolean {
  return session.role === "field_employee" && selfId === employeeId;
}
