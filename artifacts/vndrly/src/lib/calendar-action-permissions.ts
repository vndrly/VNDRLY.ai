import { isWorkHubAdmin, type WorkHubUser } from "./work-hub-client";

export function canAdministerCalendar(user: (WorkHubUser & { managedSubcontractor?: unknown }) | null | undefined) {
  return Boolean(user && !user.managedSubcontractor && (isWorkHubAdmin(user) || ["office", "both"].includes(user.vendorRole ?? "")));
}
