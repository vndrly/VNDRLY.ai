import { describe, expect, it, vi } from "vitest";
import { createMessageSoundAlert } from "./message-sound-alert";

const time = Date.parse("2026-10-06T19:00:00Z");
const notice = { type: "notification.created", userId: 7, notificationId: 12,
  notifType: "work_hub_message", audible: true, createdAt: new Date(time).toISOString() };
describe("recipient browser message sound", () => {
  it.each([{ audible: false }, { audible: undefined }, { userId: 8 }, { notifType: "ticket_assigned" },
    { createdAt: new Date(time - 120_001).toISOString() }, { createdAt: new Date(time + 31_000).toISOString() },
    { createdAt: undefined }, { notificationId: undefined }])("does not ring unauthorized, silent or stale event %j", async patch => {
    const play = vi.fn(async () => true);
    const alert = createMessageSoundAlert({ userId: 7, enabled: () => true, play, now: () => time });
    expect(await alert({ ...notice, ...patch })).toBe(false);
    expect(play).not.toHaveBeenCalled();
  });
  it("respects a disabled local sound preference", async () => {
    const play = vi.fn(async () => true);
    expect(await createMessageSoundAlert({ userId: 7, enabled: () => false, play, now: () => time })(notice)).toBe(false);
    expect(play).not.toHaveBeenCalled();
  });
  it("rings once for concurrent duplicate arrivals without browser storage", async () => {
    const play = vi.fn(async () => true);
    const alert = createMessageSoundAlert({ userId: 7, enabled: () => true, play, now: () => time });
    expect(await Promise.all([alert(notice), alert(notice)])).toEqual([true, false]);
    expect(play).toHaveBeenCalledOnce();
  });
  it("shares deduplication across tabs and permits a different message", async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    let lockQueue = Promise.resolve(false);
    const lock = (_name: string, work: () => Promise<boolean>) => (lockQueue = lockQueue.then(work));
    const play = vi.fn(async () => true);
    const create = () => createMessageSoundAlert({ userId: 7, enabled: () => true, play, storage, lock, now: () => time });
    const first = create(), second = create();
    expect(await Promise.all([first(notice), second(notice)])).toEqual([true, false]);
    expect(await second({ ...notice, notificationId: 13, notifType: "work_hub_mention" })).toBe(true);
    expect(play).toHaveBeenCalledTimes(2);
  });
  it("does not consume blocked playback and recovers from a failed player", async () => {
    const play = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("blocked")).mockResolvedValue(true);
    const alert = createMessageSoundAlert({ userId: 7, enabled: () => true, play, now: () => time });
    expect(await alert(notice)).toBe(false);
    expect(await alert(notice)).toBe(false);
    expect(await alert(notice)).toBe(true);
    expect(await alert(notice)).toBe(false);
  });
});
