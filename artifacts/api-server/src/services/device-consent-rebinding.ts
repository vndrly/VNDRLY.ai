import { pool } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { NativeOperationError } from "./native-operations-policy";

/** Preserve the original agreement and share its lineage across this user's registrations. */
export async function rebindOwnDeviceConsent(s: SessionPayload, previousDeviceId: string, deviceId: string) {
  if (!s.userId || !s.sv || s.publicDemo) throw new NativeOperationError("auth.unauthenticated", 401);
  const company = s.vendorId ? { type: "vendor", id: s.vendorId } : s.partnerId ? { type: "partner", id: s.partnerId } : null;
  if (!company) throw new NativeOperationError("native.organization_required", 403);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const user = (await c.query("SELECT session_version,suspended_at,must_change_password FROM users WHERE id=$1 FOR SHARE", [s.userId])).rows[0];
    if (!user || user.session_version !== s.sv || user.suspended_at || user.must_change_password) throw new NativeOperationError("native.current_session_required", 403);
    const membership = await c.query("SELECT id FROM user_org_memberships WHERE user_id=$1 AND org_type=$2 AND (vendor_id=$3 OR partner_id=$3) FOR SHARE", [s.userId, company.type, company.id]);
    if (!membership.rows.length) throw new NativeOperationError("native.membership_required", 403);
    await c.query("SELECT pg_advisory_xact_lock(hashtext('location-consent-device'),$1::integer)", [s.userId]);
    const owned = await c.query("SELECT id FROM work_hub_devices WHERE id=$1 AND user_id=$2 AND owner_org_type=$3 AND owner_org_id=$4 AND revoked_at IS NULL FOR SHARE", [deviceId, s.userId, company.type, company.id]);
    if (!owned.rows.length) throw new NativeOperationError("native.device_revoked", 403);
    const source = (await c.query("SELECT id,device_id,original_device_id,accepted_at,revoked_at FROM location_consents WHERE user_id=$1 AND device_id=$2 FOR UPDATE", [s.userId, previousDeviceId])).rows[0];
    const target = (await c.query("SELECT id,device_id,original_device_id,accepted_at,revoked_at FROM location_consents WHERE user_id=$1 AND device_id=$2 FOR UPDATE", [s.userId, deviceId])).rows[0];
    if (target?.revoked_at) throw new NativeOperationError("native.device_revoked", 403);
    if (!target && source && !source.revoked_at) {
      await c.query("INSERT INTO location_consents(user_id,device_id,original_device_id,accepted_at) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,device_id) DO NOTHING", [s.userId, deviceId, source.original_device_id ?? previousDeviceId, source.accepted_at]);
    }
    await c.query("COMMIT");
    return { inherited: !!target || !!source && !source.revoked_at };
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally { c.release(); }
}

/** Serialize revocation with enrollment and revoke every alias of this physical device. */
export async function revokeOwnDeviceConsent(s: SessionPayload, deviceId: string | null) {
  if (!s.userId || s.publicDemo) throw new NativeOperationError("auth.unauthenticated", 401);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext('location-consent-device'),$1::integer)", [s.userId]);
    // Native operations save the complete JSON state. Take their context locks
    // before changing it so an in-flight designation/duty save cannot restore
    // stale sharing consent after this revocation commits. Sort for revoke-all.
    const contexts = await c.query("SELECT owner_org_id FROM work_hub_device_preferences WHERE user_id=$1 AND owner_org_type='vendor' ORDER BY owner_org_id", [s.userId]);
    for (const context of contexts.rows) {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`native:${context.owner_org_id}:${s.userId}`]);
    }
    if (deviceId) {
      const row = (await c.query("SELECT COALESCE(original_device_id,device_id) AS root FROM location_consents WHERE user_id=$1 AND device_id=$2", [s.userId, deviceId])).rows[0];
      const root = row?.root ?? deviceId;
      await c.query("UPDATE location_consents SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL AND (device_id=$2 OR original_device_id=$2)", [s.userId, root]);
      await c.query("UPDATE work_hub_device_preferences SET native_operations=jsonb_set(native_operations,'{consent,locationSharing}','false'::jsonb),updated_at=now() WHERE user_id=$1 AND owner_org_type='vendor' AND (native_operations->>'designatedDeviceId' IS NULL OR native_operations->>'designatedDeviceId' IN(SELECT device_id FROM location_consents WHERE user_id=$1 AND (device_id=$2 OR original_device_id=$2)))", [s.userId, root]);
    } else {
      await c.query("UPDATE location_consents SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [s.userId]);
      await c.query("UPDATE work_hub_device_preferences SET native_operations=jsonb_set(native_operations,'{consent,locationSharing}','false'::jsonb),updated_at=now() WHERE user_id=$1 AND owner_org_type='vendor'", [s.userId]);
    }
    await c.query("COMMIT");
  } catch (error) { await c.query("ROLLBACK"); throw error; }
  finally { c.release(); }
}
