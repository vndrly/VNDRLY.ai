import type { SessionPayload } from "../lib/session";
import type { WorkHubOwner } from "@workspace/api-zod";
import { WorkHubAccessError } from "./context-access";

/** Staff may add a one-off event to their current company, without acquiring other host permissions. */
export function assertCalendarEventAccess(session: SessionPayload, owner: WorkHubOwner, event: { recurrence?: unknown; recordingAllowed: boolean; admissionMode?: string | null }) {
  const currentCompany = owner.type === "vendor" ? session.vendorId === owner.id : session.partnerId === owner.id;
  if (!session.userId || !currentCompany || event.recurrence || event.recordingAllowed || event.admissionMode) throw new WorkHubAccessError("forbidden");
}
