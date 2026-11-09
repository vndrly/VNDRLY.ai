/** Staffing notifications share one durable incident; ordinary notices retain their policy. */
export const STAFFING_NOTIFICATION_TYPES = [
  'gate_watch_radar', 'gate_coverage_uncovered', 'gate_coverage_understaffed', 'gate_coverage_unconfirmed',
] as const;
export function isStaffingNotificationType(type: string | undefined): boolean {
  return STAFFING_NOTIFICATION_TYPES.some(value => value === type);
}
export async function staffingDeliveryAllowed(notice: {id: number; type?: string}): Promise<boolean> {
  if (!isStaffingNotificationType(notice.type)) return true;
  if (!Number.isSafeInteger(notice.id) || notice.id < 1) return false;
  try {
    return await (await import('../services/gate-staffing-alerts')).staffingNotificationMayDeliver(notice.id);
  } catch { return false; } // Never release an alarm when shared state cannot be checked.
}
export async function staffingSmsCode(notice: {id: number; userId: number; type: string}): Promise<string | undefined> {
  if (!isStaffingNotificationType(notice.type)) return;
  const alert = await (await import('../services/gate-staffing-alerts')).staffingAlertForNotification(notice.id,notice.userId);
  return alert?.status === 'open' && !alert.notificationsPaused && /^[A-F0-9]{10}$/.test(alert.code) ? alert.code : undefined;
}
