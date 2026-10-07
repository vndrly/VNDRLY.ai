type Context = { userId: number; generation: number };
type Notice = { id: number; type: string; createdAt: string; isRead: boolean };
type Preferences = { pushEnabled: boolean; mode?: string; messagesEnabled?: boolean; workHubMessagesEnabled?: boolean; dndStartHour: number | null; dndEndHour: number | null };
export function isWorkHubMessagePush(data: Record<string, unknown> | undefined) {
  return data?.type === "work_hub_message" || data?.type === "work_hub_mention";
}
/** A push payload is a hint: current authenticated visible rows authorize foreground sound. */
export function createWorkHubMessageSound(deps: {
  context(): Promise<Context | null>; current(context: Context): boolean; active(): boolean;
  load(context: Context): Promise<{ notices: Notice[]; preferences: Preferences }>;
  play(): void; now?(): Date;
}) {
  let pending = Promise.resolve(false);
  const seen = new Map<string, number>();
  return (data: Record<string, unknown> | undefined): Promise<boolean> => {
    const work = async () => {
      if (!isWorkHubMessagePush(data) || !Number.isSafeInteger(data?.notificationId) || Number(data?.notificationId) <= 0 || !deps.active()) return false;
      const context = await deps.context();
      if (!context || !deps.current(context)) return false;
      const key = `${context.userId}:${data!.notificationId}`;
      let now = (deps.now ?? (() => new Date()))();
      for (const [id, at] of seen) if (now.getTime() - at > 120000) seen.delete(id);
      if (seen.has(key)) return false;
      const { notices, preferences: p } = await deps.load(context);
      if (!deps.current(context) || !deps.active() || !p.pushEnabled || (p.mode === "gate" ? p.messagesEnabled !== true : p.workHubMessagesEnabled !== true)) return false;
      now = (deps.now ?? (() => new Date()))();
      const h = now.getHours(), s = p.dndStartHour, e = p.dndEndHour;
      if (s != null && e != null && s !== e && (s < e ? h >= s && h < e : h >= s || h < e)) return false;
      const notice = notices.find(row => row.id === data!.notificationId && row.type === data!.type);
      const age = now.getTime() - Date.parse(notice?.createdAt ?? "");
      if (!notice || notice.isRead || !Number.isFinite(age) || age > 120000 || age < -30000) return false;
      if (!deps.current(context)) return false;
      seen.set(key, now.getTime());
      deps.play();
      return true;
    };
    pending = pending.then(work, work).catch(() => false);
    return pending;
  };
}
