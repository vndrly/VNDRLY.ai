// Audit recorder for QuickBooks account-mapping changes. Each create / update
// / delete on `qb_account_mapping` writes one row in
// `qb_account_mapping_audit_log` so admins can review who edited which
// mapping when. Like the export-audit recorder, an audit failure must NOT
// block the underlying write — we log and move on.

import type { Request } from "express";
import {
  db,
  qbAccountMappingAuditLogTable,
  type QbAccountMappingAuditAction,
} from "@workspace/db";
import { getSessionFromRequest as getSession } from "../session";
import { logger } from "../logger";

export interface MappingSnapshot {
  accountName: string;
  accountNumber: string | null;
}

export interface RecordMappingAuditInput {
  req: Request;
  action: QbAccountMappingAuditAction;
  mappingId: number | null;
  vendorId: number | null;
  partnerId: number | null;
  lineType: string;
  oldValues?: MappingSnapshot | null;
  newValues?: MappingSnapshot | null;
}

export async function recordMappingAudit(
  input: RecordMappingAuditInput,
): Promise<void> {
  try {
    const session = getSession(input.req);
    const actorUserId = session?.userId ?? null;
    const actorRole = session?.role ?? "anonymous";
    await db.insert(qbAccountMappingAuditLogTable).values({
      action: input.action,
      mappingId: input.mappingId,
      vendorId: input.vendorId,
      partnerId: input.partnerId,
      lineType: input.lineType,
      oldValues: input.oldValues
        ? {
            accountName: input.oldValues.accountName,
            accountNumber: input.oldValues.accountNumber,
          }
        : null,
      newValues: input.newValues
        ? {
            accountName: input.newValues.accountName,
            accountNumber: input.newValues.accountNumber,
          }
        : null,
      actorUserId,
      actorRole,
    });
  } catch (err) {
    logger.error(
      {
        err,
        action: input.action,
        lineType: input.lineType,
      },
      "Failed to record qb-account-mapping audit row",
    );
  }
}
