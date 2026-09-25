import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { pool } from "@workspace/db";
import { ACTIVE_APPROVAL_STATUSES } from "@workspace/db/schema";
import {
  getSessionFromRequest,
  SESSION_SECRET,
  type SessionPayload,
} from "../lib/session";

const changeSchema = z
  .object({
    id: z.string().uuid().optional(),
    version: z.number().int().positive().optional(),
    siteId: z.number().int().positive(),
    name: z.string().trim().min(1).max(80),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    geofenceRadiusM: z.number().int().min(1).max(10000),
    active: z.boolean(),
  })
  .refine(
    (v) => Boolean(v.id) === Boolean(v.version),
    "Editing requires the current version",
  );
type Change = z.infer<typeof changeSchema>;
const columns = `id, site_id AS "siteId", name, latitude, longitude, geofence_radius_m AS "geofenceRadiusM", active, version`;
class GateLocationError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
const deny = () => {
  throw new GateLocationError(403, "gate_locations.forbidden");
};

async function authorize(client: PoolClient, session: SessionPayload) {
  if (
    !session.userId ||
    session.role !== "vendor" ||
    !session.vendorId ||
    session.membershipRole !== "admin" ||
    session.managedSubcontractor ||
    ["gatekeeper", "gate_supervisor"].includes(session.vendorRole ?? "")
  )
    return deny();
  const result = await client.query(
    `SELECT m.id FROM user_org_memberships m JOIN users u ON u.id=m.user_id
    WHERE m.user_id=$1 AND m.vendor_id=$2 AND m.org_type='vendor' AND m.role='admin'
    AND ($3::int IS NULL OR m.id=$3) AND u.session_version=$4 AND u.suspended_at IS NULL`,
    [
      session.userId,
      session.vendorId,
      session.activeMembershipId ?? null,
      session.sv,
    ],
  );
  if (!result.rowCount) deny();
}
async function servicedSites(client: PoolClient, session: SessionPayload) {
  return (
    await client.query(
      `SELECT s.id,s.name FROM site_locations s
    WHERE s.is_active IS DISTINCT FROM false AND s.hidden IS DISTINCT FROM true
    AND EXISTS (SELECT 1 FROM site_work_assignments a WHERE a.vendor_id=$1 AND a.site_location_id=s.id)
    AND EXISTS (SELECT 1 FROM partner_vendor_relationships r WHERE r.vendor_id=$1 AND r.partner_id=s.partner_id AND r.status=ANY($2::text[]))
    ORDER BY s.name,s.id`,
      [session.vendorId, ACTIVE_APPROVAL_STATUSES],
    )
  ).rows;
}
function fingerprint(session: SessionPayload, change: Change) {
  return createHmac("sha256", SESSION_SECRET)
    .update(
      JSON.stringify([
        "gate-location",
        session.userId,
        session.vendorId,
        session.sv,
        change,
      ]),
    )
    .digest("hex");
}
function confirmation(
  session: SessionPayload,
  change: Change,
  expires = Date.now() + 600000,
) {
  const signature = createHmac("sha256", SESSION_SECRET)
    .update(`${fingerprint(session, change)}:${expires}`)
    .digest("hex");
  return `${expires}.${signature}`;
}
function verifyConfirmation(
  session: SessionPayload,
  change: Change,
  token: string,
) {
  const expiry = Number(token.split(".")[0]);
  const expected = Buffer.from(confirmation(session, change, expiry));
  const actual = Buffer.from(token);
  if (
    !Number.isSafeInteger(expiry) ||
    expiry < Date.now() ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    throw new GateLocationError(409, "gate_locations.confirmation_required");
}

/** All writes, including deactivate/reactivate, use the same exact-value review contract. */
export function createGateLocationsRouter(
  database: Pick<Pool, "connect"> = pool,
): IRouter {
  const router = Router();
  router.use("/gate-locations", async (req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    const session = getSessionFromRequest(req);
    if (!session?.userId) {
      res.status(401).json({ code: "auth.unauthenticated" });
      return;
    }
    const client = await database.connect();
    try {
      await authorize(client, session);
      next();
    } catch (error) {
      next(error);
    } finally {
      client.release();
    }
  });
  router.get("/gate-locations/sites", async (req, res) => {
    const client = await database.connect();
    try {
      res.json({
        sites: await servicedSites(client, getSessionFromRequest(req)!),
      });
    } finally {
      client.release();
    }
  });
  router.get("/gate-locations", async (req, res) => {
    const siteId = z.coerce.number().int().positive().parse(req.query.siteId);
    const client = await database.connect();
    try {
      const sites = await servicedSites(client, getSessionFromRequest(req)!);
      if (!sites.some((s) => s.id === siteId)) return deny();
      res.json({
        gates: (
          await client.query(
            `SELECT ${columns} FROM gate_stations WHERE site_id=$1 ORDER BY name,id`,
            [siteId],
          )
        ).rows,
      });
    } finally {
      client.release();
    }
  });
  router.post("/gate-locations/preview", async (req, res) => {
    const change = changeSchema.parse(req.body),
      session = getSessionFromRequest(req)!;
    const client = await database.connect();
    try {
      const sites = await servicedSites(client, session);
      if (!sites.some((s) => s.id === change.siteId)) return deny();
      res.json({ values: change, confirmation: confirmation(session, change) });
    } finally {
      client.release();
    }
  });
  router.post("/gate-locations", async (req, res) => {
    const change = changeSchema.parse(req.body),
      session = getSessionFromRequest(req)!;
    const operation = z
      .object({
        confirmation: z.string().max(256),
        idempotencyKey: z.string().uuid(),
      })
      .parse(req.body);
    const hash = fingerprint(session, change);
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '15s'");
      // Serialize retries; the audit row is the durable operation receipt, committed with the mutation.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`gate-location:${session.userId}:${operation.idempotencyKey}`],
      );
      await authorize(client, session);
      const sites = await servicedSites(client, session);
      if (!sites.some((s) => s.id === change.siteId)) return deny();
      const prior = (
        await client.query(
          `SELECT metadata FROM work_hub_audit_log WHERE actor_user_id=$1 AND owner_org_type='vendor' AND owner_org_id=$2 AND operation_id=$3 AND subject_type='gate_location'`,
          [session.userId, session.vendorId, operation.idempotencyKey],
        )
      ).rows[0];
      if (prior) {
        if (prior.metadata.fingerprint !== hash)
          throw new GateLocationError(
            409,
            "gate_locations.idempotency_conflict",
          );
        await client.query("COMMIT");
        return res.json(prior.metadata.result);
      }
      verifyConfirmation(session, change, operation.confirmation);
      const params = [
        change.siteId,
        change.name,
        change.latitude,
        change.longitude,
        change.geofenceRadiusM,
        change.active,
      ];
      const result = change.id
        ? await client.query(
            `UPDATE gate_stations SET name=$2,latitude=$3,longitude=$4,geofence_radius_m=$5,active=$6,version=version+1 WHERE id=$7 AND version=$8 AND site_id=$1 RETURNING ${columns}`,
            [...params, change.id, change.version],
          )
        : await client.query(
            `INSERT INTO gate_stations (site_id,name,latitude,longitude,geofence_radius_m,active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${columns}`,
            params,
          );
      if (!result.rowCount)
        throw new GateLocationError(409, "gate_locations.version_conflict");
      const gate = result.rows[0];
      await client.query(
        `INSERT INTO work_hub_audit_log (actor_user_id,owner_org_type,owner_org_id,action,subject_type,subject_id,prior_version,new_version,source,operation_id,metadata)
        VALUES ($1,'vendor',$2,$3,'gate_location',$4,$8,$9,$5,$6,$7::jsonb)`,
        [
          session.userId,
          session.vendorId,
          change.id ? "gate.location.updated" : "gate.location.created",
          gate.id,
          req.header("x-vndrly-client") === "ios" ? "ios" : "web",
          operation.idempotencyKey,
          JSON.stringify({ fingerprint: hash, result: gate }),
          change.version ?? null,
          gate.version,
        ],
      );
      await client.query("COMMIT");
      return res.json(gate);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
  router.use((error: any, _req: any, res: any, next: any) => {
    if (error instanceof z.ZodError)
      return res.status(400).json({ code: "validation.invalid_request" });
    if (error instanceof GateLocationError)
      return res.status(error.status).json({ code: error.code });
    if (error?.code === "23505")
      return res.status(409).json({ code: "gate_locations.name_conflict" });
    next(error);
  });
  return router;
}
export default createGateLocationsRouter();
