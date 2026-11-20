/** Display-only status rules. These never determine access or completion. */
export type ShieldStatus = 'green' | 'yellow' | 'red' | 'grey';
const day = 86_400_000;
export function agreementShield(accepted: boolean, availableAt?: string | null, now = Date.now()): ShieldStatus {
  if (accepted) return 'green';
  const start = availableAt ? Date.parse(availableAt) : NaN;
  if (!Number.isFinite(start)) return 'grey';
  const age = (now - start) / day;
  return age >= 60 ? 'red' : age >= 30 ? 'yellow' : 'grey';
}
export function expirationShield(expires?: string | null, noExpiration = false, now = new Date()): ShieldStatus {
  if (!expires) return noExpiration ? 'green' : 'grey';
  // Date-only credentials remain valid throughout their expiration day.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(expires);
  const end = new Date(dateOnly ? `${expires}T23:59:59.999` : expires);
  if (!Number.isFinite(end.getTime())) return 'grey';
  if (end.getTime() < now.getTime()) return 'red';
  const warning = new Date(end); warning.setDate(warning.getDate() - 60);
  if (dateOnly) warning.setHours(0, 0, 0, 0);
  return now >= warning ? 'yellow' : 'green';
}
export function notificationShield(prefs?: Record<string, unknown> | null): ShieldStatus {
  if (!prefs) return 'grey';
  const keys = prefs.mode === 'gate'
    ? ['scheduleEnabled','gateCrewEnabled','messagesEnabled','handoffsEnabled','tasksEnabled','complianceEnabled','alertsEnabled','alertsEmailEnabled','alertsSmsEnabled','pushEnabled']
    : ['ticketsEnabled','hotlistEnabled','complianceEnabled','crewEnabled','systemEnabled','commentsEnabled','commentMentionEmailEnabled','commentReplyEmailEnabled','workHubMessagesEnabled','pushEnabled'];
  const count = keys.filter(key => key === 'workHubMessagesEnabled' ? prefs[key] !== false : prefs[key] === true).length;
  return count === keys.length ? 'green' : count === 0 ? 'red' : 'yellow';
}
