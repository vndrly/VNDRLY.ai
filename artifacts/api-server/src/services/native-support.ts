import { z } from "zod/v4";
import { pool } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import type { PoolClient } from "pg";
import {
  NativePolicySchema,
  NativeOperationError,
  type NativePolicy,
  type NativeRequest,
} from "./native-operations-policy";
export const NativeDiagnosticSchema = z
  .object({
    deviceId: z.uuid(),
    appVersion: z.string().regex(/^[0-9A-Za-z.+_-]{1,40}$/),
    network: z.enum(["wifi", "cellular", "offline", "unknown"]),
    batteryLevel: z.number().min(0).max(1).nullable(),
    lowPower: z.boolean(),
    permissions: z
      .object({
        location: z.enum(["unknown", "granted", "denied"]),
        camera: z.enum(["unknown", "granted", "denied"]),
        notifications: z.enum(["unknown", "granted", "denied"]),
      })
      .strict(),
    pendingUploads: z.number().int().min(0).max(10000),
    syncState: z.enum(["idle", "pending", "uploading", "failed"]),
    errorCode: z
      .enum([
        "none",
        "network_unavailable",
        "permission_denied",
        "upload_expired",
        "record_revoked",
        "storage_unavailable",
        "unsupported_device",
      ])
      .default("none"),
  })
  .strict();
export function requireNativeSupportGrant(
  policy: NativePolicy,
  userId: number,
  request: NativeRequest,
  now: number,
) {
  const grant = policy.supportGrants.find(
    (g) =>
      g.userId === userId &&
      Date.parse(g.expiresAt) > now &&
      g.workerUserIds.includes(request.workerUserId) &&
      (!request.siteId || g.siteIds.includes(request.siteId)),
  );
  if (!grant)
    throw new NativeOperationError(
      "native.support_content_grant_required",
      403,
    );
  return grant;
}
async function supportActor(c: PoolClient, s: SessionPayload) {
  if (!s.userId || !s.sv || s.role !== "admin")
    throw new NativeOperationError("native.support_admin_required", 403);
  const row = await c.query(
    "SELECT id FROM users WHERE id=$1 AND role='admin' AND session_version=$2 AND suspended_at IS NULL AND must_change_password=false FOR SHARE",
    [s.userId, s.sv],
  );
  if (!row.rows.length)
    throw new NativeOperationError("native.current_session_required", 403);
}
async function tx<T>(s: SessionPayload, fn: (c: PoolClient) => Promise<T>) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await supportActor(c, s);
    const value = await fn(c);
    await c.query("COMMIT");
    return value;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function audit(
  c: PoolClient,
  s: SessionPayload,
  vendorId: number,
  payload: Record<string, unknown>,
) {
  await c.query(
    "INSERT INTO work_hub_user_events(user_id,owner_org_type,owner_org_id,event_type,payload,retention_until) VALUES($1,'vendor',$2,'native.support_access',$3::jsonb,now()+interval '365 days')",
    [s.userId, vendorId, JSON.stringify(payload)],
  );
}
export const nativeSupportService = {
  technical: (s: SessionPayload, vendorId: number) =>
    tx(s, async (c) => {
      const v = await c.query("SELECT id FROM vendors WHERE id=$1", [vendorId]);
      if (!v.rows.length)
        throw new NativeOperationError("native.company_not_found", 404);
      const devices = await c.query(
        'SELECT id,device_class AS "deviceClass",capabilities,revoked_at AS "revokedAt",updated_at AS "updatedAt" FROM work_hub_devices WHERE owner_org_type=\'vendor\' AND owner_org_id=$1 ORDER BY updated_at DESC LIMIT 100',
        [vendorId],
      );
      const diagnostics = await c.query(
        "SELECT DISTINCT ON(payload->>'deviceId') payload,created_at AS \"recordedAt\" FROM work_hub_user_events WHERE owner_org_type='vendor' AND owner_org_id=$1 AND event_type='native.diagnostic' AND retention_until>now() ORDER BY payload->>'deviceId',sequence DESC LIMIT 100",
        [vendorId],
      );
      const requests = await c.query(
        "SELECT DISTINCT ON(payload->'request'->>'id') payload->'request'->>'id' AS id,payload->'request'->>'kind' AS kind,payload->'request'->>'state' AS state,payload->'request'->>'createdAt' AS \"createdAt\",payload->'request'->>'expiresAt' AS \"expiresAt\" FROM work_hub_user_events WHERE owner_org_type='vendor' AND owner_org_id=$1 AND event_type='native.operation' AND payload ? 'request' ORDER BY payload->'request'->>'id',sequence DESC LIMIT 100",
        [vendorId],
      );
      await audit(c, s, vendorId, {
        action: "technical.read",
        contentIncluded: false,
      });
      return {
        vendorId,
        devices: devices.rows,
        diagnostics: diagnostics.rows,
        requests: requests.rows,
        contentIncluded: false,
      };
    }),
  request: (s: SessionPayload, vendorId: number, id: string) =>
    tx(s, async (c) => {
      const v = await c.query(
        "SELECT native_operations_policy FROM vendors WHERE id=$1 FOR SHARE",
        [vendorId],
      );
      if (!v.rows.length)
        throw new NativeOperationError("native.company_not_found", 404);
      const p = NativePolicySchema.parse(
        v.rows[0].native_operations_policy ?? {},
      );
      if (!p.enabled)
        throw new NativeOperationError("native.company_opted_out", 403);
      const found = await c.query(
        "SELECT payload->'request' AS request FROM work_hub_user_events WHERE owner_org_type='vendor' AND owner_org_id=$1 AND event_type='native.operation' AND payload->'request'->>'id'=$2 ORDER BY sequence DESC LIMIT 1",
        [vendorId, id],
      );
      if (!found.rows[0])
        throw new NativeOperationError("native.request_not_found", 404);
      const r = found.rows[0].request as NativeRequest;
      if (r.ticketId) {
        const canonical = await c.query(
          "SELECT site_location_id FROM tickets WHERE id=$1 AND vendor_id=$2",
          [r.ticketId, vendorId],
        );
        if (!canonical.rows.length)
          throw new NativeOperationError("native.request_scope_changed", 403);
        r.siteId = canonical.rows[0].site_location_id;
      }
      const grant = requireNativeSupportGrant(p, s.userId!, r, Date.now());
      await audit(c, s, vendorId, {
        action: "work_content.read",
        requestId: id,
        grantUserId: grant.userId,
        purpose: grant.purpose,
        grantExpiresAt: grant.expiresAt,
      });
      return {
        request: r,
        grant: { purpose: grant.purpose, expiresAt: grant.expiresAt },
      };
    }),
};
