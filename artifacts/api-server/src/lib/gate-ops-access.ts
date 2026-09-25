import type { SessionPayload } from "./session";

export function officeMayAccessGateOps(session: {
  role?: string | null;
  vendorRole?: string | null;
  membershipRole?: string | null;
} | null | undefined): boolean {
  if (!session?.role) return false;
  if (session.role === "admin" || session.role === "partner") return true;
  if (session.role !== "vendor") return false;
  if (session.membershipRole === "admin") return true;
  const role = session.vendorRole;
  return role == null || role === "office" || role === "both";
}

export function sessionHasGateOpsScope(session: Pick<SessionPayload, "role" | "vendorId" | "partnerId">): boolean {
  if (session.role === "admin") return true;
  if (session.role === "vendor") return Number(session.vendorId) > 0;
  if (session.role === "partner") return Number(session.partnerId) > 0;
  return false;
}
