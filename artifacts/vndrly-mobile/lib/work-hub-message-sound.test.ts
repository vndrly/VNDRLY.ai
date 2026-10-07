import { expect, it, vi } from "vitest";
import { createWorkHubMessageSound } from "./work-hub-message-sound";
const now = new Date("2026-10-07T12:00:00Z"), data = { type: "work_hub_message", notificationId: 12 };
function fixture() {
  let generation = 1;
  const play = vi.fn();
  const load = vi.fn(async () => ({ notices: [{ id: 12, type: data.type, createdAt: now.toISOString(), isRead: false }], preferences: { pushEnabled: true, workHubMessagesEnabled: true, dndStartHour: null as number | null, dndEndHour: null as number | null } }));
  const sound = createWorkHubMessageSound({ context: async () => ({ userId: 7, generation }), current: c => c.generation === generation, active: () => true, load, play, now: () => now });
  return { sound, play, load, invalidate: () => generation++ };
}
it("rings once across concurrent retries of the current visible message", async () => { const f = fixture(); expect(await Promise.all([f.sound(data), f.sound(data)])).toEqual([true, false]); expect(f.play).toHaveBeenCalledOnce(); });
it("refuses foreign/invisible, read, stale and disabled notifications", async () => {
  for (const patch of [{ notices: [] }, { notices: [{ id: 12, type: data.type, createdAt: now.toISOString(), isRead: true }] }, { notices: [{ id: 12, type: data.type, createdAt: "2020-01-01", isRead: false }] }, { preferences: { pushEnabled: false, workHubMessagesEnabled: true, dndStartHour: null, dndEndHour: null } }]) {
    const f = fixture(); f.load.mockResolvedValue({ ...(await f.load()), ...patch }); expect(await f.sound(data)).toBe(false); expect(f.play).not.toHaveBeenCalled();
  }
});
it("fences account changes during canonical lookup and respects message mute/DND", async () => {
  const f = fixture(); f.load.mockImplementationOnce(async () => { f.invalidate(); return { notices: [], preferences: { pushEnabled: true, workHubMessagesEnabled: true, dndStartHour: null, dndEndHour: null } }; }); expect(await f.sound(data)).toBe(false);
  for (const preferences of [{ pushEnabled: true, workHubMessagesEnabled: false, dndStartHour: null, dndEndHour: null }, { pushEnabled: true, workHubMessagesEnabled: true, dndStartHour: 0, dndEndHour: 23 }]) { const g = fixture(); g.load.mockResolvedValue({ ...(await g.load()), preferences }); expect(await g.sound(data)).toBe(false); expect(g.play).not.toHaveBeenCalled(); }
});
it("uses acceptance-time freshness after a delayed canonical lookup", async () => {
  let at = now;
  const play = vi.fn();
  const sound = createWorkHubMessageSound({ context: async () => ({ userId: 7, generation: 1 }), current: () => true, active: () => true, now: () => at, play, load: async () => { at = new Date(now.getTime() + 121000); return { notices: [{ id: 12, type: data.type, createdAt: now.toISOString(), isRead: false }], preferences: { pushEnabled: true, workHubMessagesEnabled: true, dndStartHour: null, dndEndHour: null } }; } });
  expect(await sound(data)).toBe(false); expect(play).not.toHaveBeenCalled();
});
