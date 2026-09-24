import { and, eq } from "drizzle-orm";
import {
  db,
  pool,
  userOrgMembershipsTable,
  vendorPeopleTable,
  employeeCertificationsTable,
  workHubTasksTable,
  workHubShiftsTable,
  workHubShiftAssignmentsTable,
  workHubMessagesTable,
  workHubAnnouncementsTable,
  workHubAnnouncementRecipientsTable,
  workHubMeetingOccurrencesTable,
  workHubMeetingsTable,
  workHubMeetingParticipantsTable,
  gateStationsTable,
  gateHandoversTable,
  gatePreparationsTable,
  gateShiftsTable,
  workHubFormInstancesTable,
  workHubFormTemplatesTable,
  workHubChecklistInstancesTable,
  workHubChecklistTemplatesTable,
} from "@workspace/db";
import type { SessionPayload } from "./session";
import type { GateNotificationCategory } from "./gate-notification-policy";
import { sessionCanSeeOwner } from "../work-hub/owner-boundary";

type Actor = SessionPayload & { userId: number };
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const positiveId = (value: string | null) =>
  value !== null &&
  /^[1-9]\d*$/.test(value) &&
  Number.isSafeInteger(Number(value))
    ? Number(value)
    : null;

/** A notification is a pointer, never authority. Recheck the subject on every read. */
export async function resolveNotificationDestination(
  session: Actor,
  link: string | null,
  category?: GateNotificationCategory,
): Promise<string | null> {
  if (
    !link ||
    !link.startsWith("/") ||
    link.startsWith("//") ||
    /[\\\s\u0000-\u001f]/.test(link)
  )
    return null;
  let url: URL;
  try {
    const decoded = decodeURIComponent(link);
    if (
      /[\\\u0000-\u001f]/.test(decoded) ||
      decoded.split(/[/?#]/).some((part) => part === "." || part === "..")
    )
      return null;
    url = new URL(link, "https://notification.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://notification.invalid" || url.hash) return null;
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length) return null;
  const path = url.pathname.replace(/^\/\(tabs\)/, "");
  const params = url.searchParams;
  const permittedKeys = new Set([
    "section",
    "channel",
    "channelId",
    "message",
    "messageId",
    "shift",
    "task",
    "form",
    "checklist",
    "meeting",
    "announcement",
    "siteId",
    "stationId",
    "handoffId",
    "credentialId",
  ]);
  if (keys.some((key) => !permittedKeys.has(key))) return null;
  const ownerType = session.vendorId ? "vendor" : "partner";
  const ownerId = session.vendorId ?? session.partnerId;
  const memberships = ownerId
    ? await db
        .select()
        .from(userOrgMembershipsTable)
        .where(
          and(
            eq(userOrgMembershipsTable.userId, session.userId),
            eq(userOrgMembershipsTable.orgType, ownerType),
            ownerType === "vendor"
              ? eq(userOrgMembershipsTable.vendorId, ownerId)
              : eq(userOrgMembershipsTable.partnerId, ownerId),
          ),
        )
        .limit(1)
    : [];
  if (session.role !== "admin" && !memberships.length) return null;
  const ownerAllowed = (row: { ownerOrgType: string; ownerOrgId: number }) =>
    sessionCanSeeOwner(session, row.ownerOrgType, row.ownerOrgId);
  const authorizeChannel = async (channelId: string) => {
    if (!uuid.test(channelId)) return false;
    const { resolveChannelAccess } = await import("../work-hub/queries");
    const { channel } = await resolveChannelAccess(
      session,
      channelId,
      "channel.read",
    );
    if (!ownerAllowed(channel)) return false;
    if (category === "gate_crew" && channel.contextKind !== "gate")
      return false;
    if (channel.contextKind === "gate" || channel.contextKind === "site") {
      const { requireChangeOverAccess } =
        await import("../services/gate-change-over");
      await requireChangeOverAccess(pool, session, Number(channel.contextId));
    }
    return true;
  };
  try {
    if (path === "/profile") {
      if (keys.some((key) => !["section", "credentialId"].includes(key)))
        return null;
      if (params.has("section") && params.get("section") !== "compliance")
        return null;
      const credentialId = positiveId(params.get("credentialId"));
      if (!credentialId) return null;
      const [credential] = await db
        .select()
        .from(employeeCertificationsTable)
        .where(eq(employeeCertificationsTable.id, credentialId))
        .limit(1);
      if (!credential || credential.deletedAt) return null;
      const [person] = await db
        .select()
        .from(vendorPeopleTable)
        .where(
          and(
            eq(vendorPeopleTable.id, credential.employeeId),
            eq(vendorPeopleTable.userId, session.userId),
          ),
        )
        .limit(1);
      return person && !person.deletedAt && person.vendorId === session.vendorId
        ? link
        : null;
    }
    if (
      path === "/shift-notes" ||
      path === "/gate" ||
      path === "/gate-change-over"
    ) {
      if (
        keys.some((key) => !["stationId", "handoffId", "siteId"].includes(key))
      )
        return null;
      const stationId = params.get("stationId");
      let siteId = positiveId(params.get("siteId"));
      if (stationId) {
        if (!uuid.test(stationId)) return null;
        const [station] = await db
          .select()
          .from(gateStationsTable)
          .where(eq(gateStationsTable.id, stationId))
          .limit(1);
        if (!station || (siteId !== null && siteId !== station.siteId))
          return null;
        siteId = station.siteId;
      }
      if (!siteId || (path === "/shift-notes" && !stationId)) return null;
      const { requireChangeOverAccess } =
        await import("../services/gate-change-over");
      await requireChangeOverAccess(pool, session, siteId);
      const handoffId = params.get("handoffId");
      if (handoffId) {
        if (!uuid.test(handoffId) || !stationId) return null;
        const [handoff] = await db
          .select()
          .from(gateHandoversTable)
          .where(eq(gateHandoversTable.id, handoffId))
          .limit(1);
        if (!handoff) return null;
        const [preparation] = await db
          .select()
          .from(gatePreparationsTable)
          .where(eq(gatePreparationsTable.id, handoff.preparationId))
          .limit(1);
        if (!preparation) return null;
        const [shift] = await db
          .select()
          .from(gateShiftsTable)
          .where(eq(gateShiftsTable.id, preparation.shiftId))
          .limit(1);
        if (!shift || shift.stationId !== stationId) return null;
      }
      return link;
    }
    if (
      !/^\/work-hub(?:\/(?:channels|tasks|meetings)\/[^/]+|\/calendar|\/tasks)?$/.test(
        path,
      )
    )
      return null;
    if (
      keys.some((key) =>
        ["siteId", "stationId", "handoffId", "credentialId"].includes(key),
      )
    )
      return null;
    const pathSubject = path.match(
      /^\/work-hub\/(channels|tasks|meetings)\/([^/]+)$/,
    );
    const selectors = [
      "channel",
      "channelId",
      "task",
      "form",
      "checklist",
      "shift",
      "meeting",
      "announcement",
    ].filter((key) => params.has(key));
    if (selectors.length + (pathSubject ? 1 : 0) !== 1) return null;
    const kind = pathSubject
      ? ({ channels: "channel", tasks: "task", meetings: "meeting" } as const)[
          pathSubject[1] as "channels" | "tasks" | "meetings"
        ]
      : selectors[0];
    const id = pathSubject?.[2] ?? params.get(selectors[0])!;
    if (!uuid.test(id)) return null;
    const messageId = params.get("message") ?? params.get("messageId");
    if (params.has("message") && params.has("messageId")) return null;
    if (messageId && kind !== "channel" && kind !== "channelId") return null;
    if (kind === "channel" || kind === "channelId") {
      if (!(await authorizeChannel(id))) return null;
      if (messageId) {
        if (!uuid.test(messageId)) return null;
        const [message] = await db
          .select()
          .from(workHubMessagesTable)
          .where(
            and(
              eq(workHubMessagesTable.id, messageId),
              eq(workHubMessagesTable.channelId, id),
            ),
          )
          .limit(1);
        if (!message || message.deletedAt) return null;
      }
      return link;
    }
    if (kind === "task") {
      const [task] = await db
        .select()
        .from(workHubTasksTable)
        .where(eq(workHubTasksTable.id, id))
        .limit(1);
      if (
        !task ||
        !ownerAllowed(task) ||
        (session.managedSubcontractor &&
          task.assigneeUserId !== session.userId &&
          task.createdById !== session.userId)
      )
        return null;
      if (task.channelId && !(await authorizeChannel(task.channelId)))
        return null;
      return link;
    }
    if (kind === "form" || kind === "checklist") {
      const table =
        kind === "form"
          ? workHubFormInstancesTable
          : workHubChecklistInstancesTable;
      const templates =
        kind === "form"
          ? workHubFormTemplatesTable
          : workHubChecklistTemplatesTable;
      const [instance] = await db
        .select()
        .from(table)
        .where(eq(table.id, id))
        .limit(1);
      if (!instance || instance.assigneeUserId !== session.userId) return null;
      const [template] = await db
        .select()
        .from(templates)
        .where(eq(templates.id, instance.templateId))
        .limit(1);
      if (!template || !ownerAllowed(template)) return null;
      if (instance.channelId && !(await authorizeChannel(instance.channelId)))
        return null;
      return link;
    }
    if (kind === "shift") {
      const [shift] = await db
        .select()
        .from(workHubShiftsTable)
        .where(eq(workHubShiftsTable.id, id))
        .limit(1);
      if (!shift || !ownerAllowed(shift)) return null;
      const [assigned] = await db
        .select()
        .from(workHubShiftAssignmentsTable)
        .where(
          and(
            eq(workHubShiftAssignmentsTable.shiftId, id),
            eq(workHubShiftAssignmentsTable.userId, session.userId),
          ),
        )
        .limit(1);
      if (
        session.managedSubcontractor &&
        shift.createdById !== session.userId &&
        !assigned &&
        !(shift.sharedWithUserIds ?? []).includes(session.userId)
      )
        return null;
      if (shift.channelId && !(await authorizeChannel(shift.channelId)))
        return null;
      if (shift.siteLocationId) {
        const { requireChangeOverAccess } =
          await import("../services/gate-change-over");
        await requireChangeOverAccess(pool, session, shift.siteLocationId);
      }
      return link;
    }
    if (kind === "announcement") {
      const [announcement] = await db
        .select()
        .from(workHubAnnouncementsTable)
        .where(eq(workHubAnnouncementsTable.id, id))
        .limit(1);
      if (
        !announcement ||
        !ownerAllowed(announcement) ||
        announcement.withdrawnAt
      )
        return null;
      const [recipient] = await db
        .select()
        .from(workHubAnnouncementRecipientsTable)
        .where(
          and(
            eq(workHubAnnouncementRecipientsTable.announcementId, id),
            eq(workHubAnnouncementRecipientsTable.userId, session.userId),
          ),
        )
        .limit(1);
      if (!recipient && memberships[0]?.role !== "admin") return null;
      if (category === "gate_crew" && !announcement.channelId) return null;
      if (
        announcement.channelId &&
        !(await authorizeChannel(announcement.channelId))
      )
        return null;
      return link;
    }
    if (kind === "meeting") {
      const [occurrence] = await db
        .select()
        .from(workHubMeetingOccurrencesTable)
        .where(eq(workHubMeetingOccurrencesTable.id, id))
        .limit(1);
      if (!occurrence) return null;
      const [meeting] = await db
        .select()
        .from(workHubMeetingsTable)
        .where(eq(workHubMeetingsTable.id, occurrence.meetingId))
        .limit(1);
      if (!meeting || !ownerAllowed(meeting)) return null;
      const [participant] = await db
        .select()
        .from(workHubMeetingParticipantsTable)
        .where(
          and(
            eq(workHubMeetingParticipantsTable.occurrenceId, id),
            eq(workHubMeetingParticipantsTable.userId, session.userId),
          ),
        )
        .limit(1);
      if (participant?.removedAt) return null;
      if (
        !participant &&
        session.role !== "admin" &&
        memberships[0]?.role !== "admin"
      )
        return null;
      if (meeting.channelId && !(await authorizeChannel(meeting.channelId)))
        return null;
      return link;
    }
    return null;
  } catch (error) {
    // Authorization failures intentionally reveal no subject or tenant detail.
    // Operational failures propagate, rather than pretending the whole inbox is empty.
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 403 || status === 404) return null;
    throw error;
  }
}
