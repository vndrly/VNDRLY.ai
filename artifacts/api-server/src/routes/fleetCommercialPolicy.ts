import { Router } from "express";
import { z } from "zod/v4";
import { pool, ACTIVE_APPROVAL_STATUSES } from "@workspace/db";
import { getSessionFromRequest } from "../lib/session";
const router = Router();
router.all("/fleet/site-ticket-policy/:siteId", async (req, res, next) => {
  if (!["GET", "PATCH"].includes(req.method)) {
    next();
    return;
  }
  const session = getSessionFromRequest(req);
  if (!session?.userId || typeof session.sv !== "number") {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  const siteId = z.coerce.number().int().positive().parse(req.params.siteId),
    c = await pool.connect();
  try {
    await c.query("BEGIN");
    const user = (
      await c.query(
        "SELECT id,role FROM users WHERE id=$1 AND session_version=$2 AND suspended_at IS NULL FOR SHARE",
        [session.userId, session.sv],
      )
    ).rows[0];
    if (!user) {
      res.status(403).json({ error: "Current session required" });
      return;
    }
    const site = (
      await c.query(
        "SELECT id,partner_id,fleet_ticket_policy FROM site_locations WHERE id=$1 AND COALESCE(hidden,false)=false FOR UPDATE",
        [siteId],
      )
    ).rows[0];
    if (!site) {
      res.status(404).json({ error: "Site not found" });
      return;
    }
    const orgType = session.role === "partner" ? "partner" : "vendor",
      orgId = orgType === "partner" ? session.partnerId : session.vendorId;
    let canRead = false,
      canManage = false;
    if (session.role === "admin" && user.role === "admin") {
      canRead = true;
      canManage = true;
    } else {
      const member = (
        await c.query(
          "SELECT role FROM user_org_memberships WHERE id=$1 AND user_id=$2 AND org_type=$3 AND (CASE WHEN $3='partner' THEN partner_id ELSE vendor_id END)=$4 FOR SHARE",
          [session.activeMembershipId, session.userId, orgType, orgId],
        )
      ).rows[0];
      if (member) {
        if (orgType === "partner" && orgId === site.partner_id) {
          canRead = true;
          canManage = member.role === "admin";
        } else if (orgType === "vendor") {
          canRead =
            (
              await c.query(
                "SELECT 1 FROM partner_vendor_relationships WHERE vendor_id=$1 AND partner_id=$2 AND status=ANY($3::text[]) FOR SHARE",
                [orgId, site.partner_id, [...ACTIVE_APPROVAL_STATUSES]],
              )
            ).rows.length > 0;
        }
      }
    }
    if (!canRead) {
      res.status(403).json({ error: "Site access required" });
      return;
    }
    const previous = site.fleet_ticket_policy ?? { version: 1, mode: null };
    let value = { version: previous.version ?? 1, mode: previous.mode ?? null };
    if (req.method === "PATCH") {
      if (!canManage) {
        res
          .status(403)
          .json({
            error:
              "Only the site partner administrator can set this requirement",
          });
        return;
      }
      const body = z
        .object({
          expectedVersion: z.number().int().positive(),
          mode: z.enum(["batch", "singles"]).nullable(),
        })
        .strict()
        .parse(req.body);
      if (body.expectedVersion !== value.version) {
        res
          .status(409)
          .json({ error: "Site policy changed. Review the latest setting." });
        return;
      }
      value = { version: value.version + 1, mode: body.mode };
      await c.query(
        "UPDATE site_locations SET fleet_ticket_policy=$2::jsonb WHERE id=$1",
        [
          siteId,
          JSON.stringify({
            ...value,
            changedByUserId: session.userId,
            changedAt: new Date().toISOString(),
          }),
        ],
      );
      await c.query(
        "INSERT INTO assistant_action_audit(user_id,partner_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'web','typed','canonical','fleet_site_ticket_policy','fleet-policy-update','site',$3,$4::jsonb,'completed')",
        [
          session.userId,
          site.partner_id,
          String(siteId),
          JSON.stringify(value),
        ],
      );
    }
    await c.query("COMMIT");
    res.json({ ...value, canManage });
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});
export default router;
