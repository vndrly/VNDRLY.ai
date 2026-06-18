// Shared helpers for AskV read-only data tools.

import { eq, sql } from "drizzle-orm";
import { ticketsTable } from "@workspace/db";
import type { SessionPayload } from "../lib/session";

export const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;
export const MAX_SINCE_DAYS = 365;
export const DEFAULT_SINCE_DAYS = 30;

export function clampLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
}

export function clampSinceDays(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SINCE_DAYS;
  return Math.min(MAX_SINCE_DAYS, Math.max(1, Math.floor(n)));
}

export function sinceDate(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

export function err(message: string): string {
  return JSON.stringify({ error: message });
}

export function blockFieldEmployee(session: SessionPayload, capability: string): string | null {
  if (session.role === "field_employee") {
    return err(`The '${capability}' tool is not available to field employees. Open the field portal home to see your own tickets.`);
  }
  return null;
}

/** Org-scoping ticket filter for the caller. */
export function ticketScopeFilters(session: SessionPayload): unknown[] | null {
  if (session.role === "admin") return [];
  if (session.role === "partner" && session.partnerId) {
    return [
      sql`${ticketsTable.siteLocationId} IN (SELECT id FROM site_locations WHERE partner_id = ${session.partnerId})`,
    ];
  }
  if (session.role === "vendor" && session.vendorId) {
    return [eq(ticketsTable.vendorId, session.vendorId)];
  }
  if (session.role === "field_employee" && session.vendorPeopleId) {
    const vpId = session.vendorPeopleId;
    const userId = session.userId ?? 0;
    return [
      sql`(
        ${ticketsTable.fieldEmployeeId} = ${vpId}
        OR ${ticketsTable.foremanUserId} = ${userId}
        OR ${ticketsTable.actingForemanUserId} = ${userId}
        OR EXISTS (
          SELECT 1 FROM ticket_crew tc
          WHERE tc.ticket_id = ${ticketsTable.id}
            AND tc.employee_id = ${vpId}
            AND tc.removed_at IS NULL
        )
      )`,
    ];
  }
  return null;
}
