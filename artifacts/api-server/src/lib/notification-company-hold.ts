import { pool } from '@workspace/db';
import { logger } from './logger';

// Operational hold requested by John on 2026-11-09. No timer, environment
// default, restart, deployment or user preference can resume this company.
// Remove a hold ONLY after John's explicit instruction to resume notifications.
export const NOTIFICATION_COMPANY_HOLDS = [{ vendorId: 1054, company: 'MidCon Solutions', reason: 'Paused until John explicitly instructs resume', expiresAt: null }] as const;
type QueryClient = { query(sql: string, values: any[]): Promise<{ rows: any[] }> };

export async function pausedNotificationUserIds(userIds: number[], client?: QueryClient, options: { throwOnLookupError?: boolean } = {}): Promise<Set<number>> {
  if (!userIds.length) return new Set();
  try {
    const { rows } = await (client ?? pool).query(`SELECT DISTINCT recipient.user_id FROM (
      SELECT user_id FROM user_org_memberships WHERE org_type='vendor' AND vendor_id=ANY($2::int[])
      UNION SELECT user_id FROM vendor_people WHERE vendor_id=ANY($2::int[]) AND user_id IS NOT NULL AND deleted_at IS NULL
      UNION SELECT worker_user_id FROM managed_subcontractor_worker_sponsorships WHERE sponsor_vendor_id=ANY($2::int[]) AND status='active' AND ended_at IS NULL
    ) recipient WHERE recipient.user_id=ANY($1::int[])`, [userIds, NOTIFICATION_COMPANY_HOLDS.map(h => h.vendorId)]);
    return new Set(rows.map(r => Number(r.user_id)));
  } catch (error) {
    // A failed lookup must not turn a held recipient's notifications back on.
    logger.warn({ error: error instanceof Error ? error.name : 'lookup_failed' }, 'Notification company hold lookup unavailable; delivery withheld');
    // Durable queue decisions must distinguish a confirmed hold from a lookup
    // outage. Provider guards retain the default fail-closed result below.
    if (options.throwOnLookupError) throw error;
    return new Set(userIds);
  }
}
export async function notificationCompanyHoldApplies(userId: number) {
  return (await pausedNotificationUserIds([userId])).has(userId);
}
export async function notificationTokenHoldApplies(token: string) {
  try {
    const { rows } = await pool.query('SELECT user_id FROM field_push_tokens WHERE expo_token=$1', [token]);
    if (!rows.length) return true; // Unknown destinations are not authorized sends.
    return (await pausedNotificationUserIds(rows.map(r => Number(r.user_id)))).size > 0;
  } catch { return true; }
}

/** Notification email only; password resets and sign-in verification are separate. */
export async function notificationEmailHoldApplies(email: string) {
  try {
    const { rows } = await pool.query('SELECT id AS user_id FROM users WHERE lower(email)=lower($1) OR lower(username)=lower($1)', [email]);
    return (await pausedNotificationUserIds(rows.map(r => Number(r.user_id)))).size > 0;
  } catch { return true; }
}
