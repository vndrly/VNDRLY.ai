import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { getObjectStore } from "../lib/objectStore";
import type { PoolClient } from "pg";
import {
  authorizeOfflineGateObservation,
  OfflineGateError,
} from "./gate-offline-observation";

import type { SessionPayload } from "../lib/session";

export const GateIdentityInput = z
  .object({
    operationId: z.uuid(),
    objectPath: z.string().regex(/^\/objects\/uploads\/[0-9a-f-]{36}$/i),
    capturedAt: z.iso.datetime(),
    reviewConfirmed: z.literal(true),
    source: z.enum(["visionkit_document_scan", "camera_manual_review"]),
    fields: z
      .object({
        firstName: z.string().trim().min(1).max(100),
        lastName: z.string().trim().min(1).max(100),
        documentType: z.string().trim().max(100),
        issuingRegion: z.string().trim().max(100),
        documentLastFour: z
          .string()
          .regex(/^[A-Za-z0-9]{1,4}$/)
          .optional(),
        expiresOn: z.iso.date().optional(),
      })
      .strict(),
  })
  .strict();
export class GateIdentityError extends Error {
  constructor(
    message: string,
    public status = 403,
  ) {
    super(message);
  }
}
export function gateIdentityDeadline(visit: {
  check_in_time: Date | string;
  check_out_time?: Date | string | null;
}) {
  return new Date(
    new Date(visit.check_out_time ?? visit.check_in_time).getTime() +
      30 * 86400000,
  );
}
export async function authorizeGateIdentity(
  session: SessionPayload,
  siteId: number,
  transactionClient?: PoolClient,
) {
  if (transactionClient) {
    try {
      await authorizeOfflineGateObservation(transactionClient, session, siteId);
    } catch (e) {
      if (e instanceof OfflineGateError)
        throw new GateIdentityError(e.code, e.status);
      throw e;
    }
    return;
  }
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    try {
      await authorizeOfflineGateObservation(c, session, siteId);
    } catch (e) {
      if (e instanceof OfflineGateError)
        throw new GateIdentityError(e.code, e.status);
      throw e;
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function readGateIdentity(
  session: SessionPayload,
  visitId: number,
) {
  const { rows } = await pool.query(
    "SELECT id,site_location_id,check_in_time,check_out_time,gate_identity_document FROM site_visits WHERE id=$1",
    [visitId],
  );
  const visit = rows[0];
  if (!visit) throw new GateIdentityError("Visit unavailable", 404);
  await authorizeGateIdentity(session, visit.site_location_id);
  const doc = visit.gate_identity_document;
  if (!doc) throw new GateIdentityError("Identity document unavailable", 404);
  const expiresAt = gateIdentityDeadline(visit).toISOString();
  return {
    ...doc,
    id: visitId,
    visitId,
    expiresAt,
    imageAvailable: Date.now() < Date.parse(expiresAt),
    objectPath: Date.now() < Date.parse(expiresAt) ? doc.objectPath : null,
  };
}
export async function canReadGateIdentityObject(
  session: SessionPayload | null,
  objectPath: string,
) {
  if (!session) return false;
  const { rows } = await pool.query(
    "SELECT id FROM site_visits WHERE gate_identity_document->>'objectPath'=$1 LIMIT 1",
    [objectPath],
  );
  if (!rows[0]) return false;
  try {
    const result = await readGateIdentity(session, rows[0].id);
    return result.imageAvailable && result.objectPath === objectPath;
  } catch {
    return false;
  }
}
export async function saveGateIdentity(
  session: SessionPayload,
  visitId: number,
  raw: unknown,
) {
  const input = GateIdentityInput.parse(raw);
  if (Date.parse(input.capturedAt) > Date.now() + 60_000)
    throw new GateIdentityError("Capture time is in the future", 400);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "gate-identity:" + input.operationId,
    ]);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "gate-identity-object:" + input.objectPath,
    ]);
    const { rows } = await client.query(
      "SELECT id,site_location_id,check_in_time,check_out_time,gate_identity_document FROM site_visits WHERE id=$1 FOR UPDATE",
      [visitId],
    );
    const visit = rows[0];
    if (!visit) throw new GateIdentityError("Visit unavailable", 404);
    await authorizeGateIdentity(session, visit.site_location_id, client);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([session.userId, visitId, input]))
      .digest("hex");
    const action = await client.query(
      "SELECT user_id,tool_input FROM assistant_action_audit WHERE target_type='gate-identity-review' AND target_id=$1 ORDER BY id LIMIT 1",
      [input.operationId],
    );
    if (
      action.rows[0] &&
      (action.rows[0].user_id !== session.userId ||
        action.rows[0].tool_input.visitId !== visitId ||
        action.rows[0].tool_input.fingerprint !== fingerprint)
    )
      throw new GateIdentityError("Identity document operation conflict", 409);
    const prior = visit.gate_identity_document;
    if (prior) {
      if (
        prior.operationId !== input.operationId ||
        prior.fingerprint !== fingerprint
      )
        throw new GateIdentityError(
          "Identity document operation conflict",
          409,
        );
      await client.query("COMMIT");
      return readGateIdentity(session, visitId);
    }
    if (
      visit.check_out_time ||
      Date.now() >= gateIdentityDeadline(visit).getTime()
    )
      throw new GateIdentityError("An active visit is required", 409);
    const source = await getObjectStore().getObject(input.objectPath);
    const bytes = source?.body;
    const type = source?.contentType.toLowerCase().split(";")[0];
    const valid =
      type === "image/jpeg"
        ? bytes && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : type === "image/png"
          ? bytes
              ?.subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : type === "image/webp"
            ? bytes?.subarray(0, 4).toString() === "RIFF" &&
              bytes?.subarray(8, 12).toString() === "WEBP"
            : false;
    if (
      !source ||
      source.acl?.owner !== String(session.userId) ||
      source.acl.visibility !== "private" ||
      (source.acl.purpose && source.acl.purpose !== "gate-id") ||
      !valid ||
      !source.body.length ||
      source.size !== source.body.length ||
      source.size > 25 * 1024 * 1024
    )
      throw new GateIdentityError("Private owned reviewed image required", 400);
    const duplicate = await client.query(
      "SELECT id FROM site_visits WHERE gate_identity_document->>'objectPath'=$1 LIMIT 1",
      [input.objectPath],
    );
    if (duplicate.rowCount)
      throw new GateIdentityError(
        "Image already belongs to another visit",
        409,
      );
    await getObjectStore().setAcl(input.objectPath, {
      owner: String(session.userId),
      visibility: "private",
      purpose: "gate-id",
    });
    const document = {
      ...input,
      retentionPolicy:
        "thirty_days_after_reported_visit_closure_or_entry_while_open",
      reviewedByUserId: session.userId,
      fingerprint,
      sha256: createHash("sha256").update(source.body).digest("hex"),
      savedAt: new Date().toISOString(),
    };
    await authorizeGateIdentity(session, visit.site_location_id, client);
    await client.query(
      "UPDATE site_visits SET gate_identity_document=$2::jsonb WHERE id=$1",
      [visitId, JSON.stringify(document)],
    );
    await client.query(
      "INSERT INTO assistant_action_audit(user_id,actor_role,partner_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_input,tool_output,result_status) VALUES($1,$2,$3,$4,'ios','device_entry','vndrly','save_reviewed_gate_identity','mutation','gate-identity-review',$5,$6::jsonb,$7::jsonb,'success')",
      [
        session.userId,
        session.role,
        session.partnerId ?? null,
        session.vendorId ?? null,
        input.operationId,
        JSON.stringify({ visitId, fingerprint }),
        JSON.stringify({
          visitId,
          operationId: input.operationId,
          sha256: document.sha256,
          reviewConfirmed: true,
        }),
      ],
    );
    await client.query("COMMIT");
    return readGateIdentity(session, visitId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
/** Storage is denied at the deadline even before this bounded physical purge runs. */
export async function purgeExpiredGateIdentityImages(now = new Date()) {
  const { rows } = await pool.query(
    "SELECT id,gate_identity_document->>'objectPath' AS path FROM site_visits WHERE gate_identity_document->>'objectPath' IS NOT NULL AND COALESCE(check_out_time,check_in_time)+interval '30 days'<=$1",
    [now],
  );
  let removed = 0;
  for (const row of rows) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "gate-identity-object:" + row.path,
      ]);
      const locked = await c.query(
        "SELECT id,check_in_time,check_out_time,gate_identity_document FROM site_visits WHERE id=$1 FOR UPDATE",
        [row.id],
      );
      const visit = locked.rows[0];
      if (
        visit?.gate_identity_document?.objectPath === row.path &&
        gateIdentityDeadline(visit).getTime() <= now.getTime()
      ) {
        await getObjectStore().deleteObject(row.path);
        await c.query(
          "UPDATE site_visits SET gate_identity_document=(gate_identity_document - 'objectPath') || jsonb_build_object('imageDeletedAt',$2::text) WHERE id=$1 AND gate_identity_document->>'objectPath'=$3",
          [row.id, now.toISOString(), row.path],
        );
        removed++;
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  return removed;
}
