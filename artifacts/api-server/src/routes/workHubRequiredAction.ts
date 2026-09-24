import { Router } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  pool,
  userOrgMembershipsTable,
  workHubFormInstancesTable,
  workHubFormTemplatesTable,
  workHubChecklistInstancesTable,
  workHubChecklistTemplatesTable,
} from "@workspace/db";
import { getSessionFromRequest } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { isWorkHubEnabled } from "../work-hub/feature-access";
import { sessionCanSeeOwner } from "../work-hub/owner-boundary";
import { resolveChannelAccess } from "../work-hub/queries";
import { requireChangeOverAccess } from "../services/gate-change-over";

const router = Router();
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Exact assigned snapshot reader; never fetch a user's entire assignment history. */
router.get("/work-hub/required-actions/:kind/:id", async (req, res) => {
  const unavailable = () =>
    sendApiError(res, 404, "work_hub.not_found", "Not found");
  if (!(await isWorkHubEnabled())) return unavailable();
  const session = getSessionFromRequest(req);
  if (!session?.userId)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  const { kind, id } = req.params;
  if ((kind !== "form" && kind !== "checklist") || !uuid.test(id))
    return unavailable();
  const instances =
    kind === "form"
      ? workHubFormInstancesTable
      : workHubChecklistInstancesTable;
  const templates =
    kind === "form"
      ? workHubFormTemplatesTable
      : workHubChecklistTemplatesTable;
  const [instance] = await db
    .select()
    .from(instances)
    .where(
      and(eq(instances.id, id), eq(instances.assigneeUserId, session.userId)),
    )
    .limit(1);
  if (!instance) return unavailable();
  const [template] = await db
    .select()
    .from(templates)
    .where(eq(templates.id, instance.templateId))
    .limit(1);
  if (
    !template ||
    !sessionCanSeeOwner(session, template.ownerOrgType, template.ownerOrgId)
  )
    return unavailable();
  // Signed context is not proof that membership is still active.
  if (session.role !== "admin") {
    const [membership] = await db
      .select()
      .from(userOrgMembershipsTable)
      .where(
        and(
          eq(userOrgMembershipsTable.userId, session.userId),
          eq(userOrgMembershipsTable.orgType, template.ownerOrgType),
          template.ownerOrgType === "vendor"
            ? eq(userOrgMembershipsTable.vendorId, template.ownerOrgId)
            : eq(userOrgMembershipsTable.partnerId, template.ownerOrgId),
        ),
      )
      .limit(1);
    if (!membership) return unavailable();
  }
  if (instance.channelId) {
    try {
      const { channel } = await resolveChannelAccess(
        { ...session, userId: session.userId },
        instance.channelId,
        "channel.read",
      );
      if (
        channel.ownerOrgType !== template.ownerOrgType ||
        channel.ownerOrgId !== template.ownerOrgId
      )
        return unavailable();
      if (channel.contextKind === "gate" || channel.contextKind === "site")
        await requireChangeOverAccess(pool, session, Number(channel.contextId));
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403 || status === 404)
        return unavailable();
      throw error;
    }
  }
  return res.json({
    instance,
    template: { id: template.id, name: template.name },
  });
});
export default router;
