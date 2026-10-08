import { pool } from "@workspace/db";
import { z } from "zod/v4";
import type { SessionPayload } from "../lib/session";
import { NativeOperationError } from "./native-operations-policy";
export async function bindNativePushToken(session: SessionPayload, raw: unknown) {
 const input=z.object({token:z.string().regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/),platform:z.enum(["ios","android"]).optional(),deviceId:z.uuid()}).strict().parse(raw);
 if(!session.userId||(!session.vendorId&&!session.partnerId))throw new NativeOperationError("native.organization_required",403);
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const user=await client.query("SELECT id FROM users WHERE id=$1 AND session_version=$2 AND suspended_at IS NULL AND must_change_password=false FOR SHARE",[session.userId,session.sv]);
  if(!user.rows.length)throw new NativeOperationError("native.current_session_required",403);
  const orgType=session.vendorId?"vendor":"partner",orgId=session.vendorId??session.partnerId;
  const membership=await client.query("SELECT id FROM user_org_memberships WHERE user_id=$1 AND org_type=$2 AND (vendor_id=$3 OR partner_id=$3) FOR SHARE",[session.userId,orgType,orgId]);
  if(!membership.rows.length)throw new NativeOperationError("native.membership_required",403);
  const device=await client.query("SELECT id FROM work_hub_devices WHERE id=$1 AND user_id=$2 AND owner_org_type=$3 AND owner_org_id=$4 AND revoked_at IS NULL AND device_class IN('phone','ios','iphone','mobile') FOR SHARE",[input.deviceId,session.userId,orgType,orgId]);
  if(!device.rows.length)throw new NativeOperationError("native.work_phone_required",403);
  await client.query("INSERT INTO field_push_tokens(user_id,expo_token,platform,native_device_id) VALUES($1,$2,$3,$4) ON CONFLICT(expo_token) DO UPDATE SET user_id=EXCLUDED.user_id,platform=EXCLUDED.platform,native_device_id=EXCLUDED.native_device_id",[session.userId,input.token,input.platform??null,input.deviceId]);
  await client.query("COMMIT");
 }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
