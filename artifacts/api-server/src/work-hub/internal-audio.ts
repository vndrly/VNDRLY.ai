import { createHmac, randomUUID } from "node:crypto";
import { validateMeetingConsent } from "./domain-rules";

/** Optional self-hosted coturn credentials. No paid calling API is required. */
export function audioIceServers(env: Record<string, string | undefined>, userId: number, now = Math.floor(Date.now() / 1000)) {
  const urls = (env.WORK_HUB_TURN_URLS ?? "").split(",").map(x => x.trim()).filter(x => /^turns?:[^\s]+$/.test(x));
  if (!urls.length || !env.WORK_HUB_TURN_SECRET) return [];
  const username = `${now + 3600}:${userId}`;
  return [{ urls, username, credential: createHmac("sha1", env.WORK_HUB_TURN_SECRET).update(username).digest("base64") }];
}

export function captureAllowed(input: { role: string; recordingAllowed: boolean; policyVersion: number; consents: Array<{ userId: number; policyVersion: number; response: string }>; present: number[] }) {
  return input.role === "host" && input.recordingAllowed && input.present.length > 0 &&
    validateMeetingConsent(input.policyVersion, input.consents.map(x => ({ ...x, response: x.response === "accepted" ? "accepted" as const : "declined" as const })), input.present).allowed;
}

type Signal = { id: string; sequence: number; fromUserId: number; toUserId: number; kind: "offer" | "answer" | "ice"; payload: unknown; createdAt: number };
/** Signals are ephemeral, bounded and addressed; sequence cursors avoid timestamp collisions. */
export class SignalMailbox {
  private rooms = new Map<string, Signal[]>();
  private sequence = Date.now();
  private prune(now: number) {
    for (const [room, signals] of this.rooms) {
      const fresh = signals.filter(x => now - x.createdAt < 300_000);
      if (fresh.length) this.rooms.set(room, fresh); else this.rooms.delete(room);
    }
  }
  append(room: string, fromUserId: number, toUserId: number, kind: Signal["kind"], payload: unknown, now = Date.now()) {
    this.prune(now);
    const values = this.rooms.get(room) ?? [];
    if (values.length >= 2000 || (!this.rooms.has(room) && this.rooms.size >= 1000)) throw new Error("Audio signaling capacity reached; retry shortly");
    const signal = { id: randomUUID(), sequence: ++this.sequence, fromUserId, toUserId, kind, payload, createdAt: now };
    this.rooms.set(room, [...values, signal]);
    return signal;
  }
  read(room: string, userId: number, since: number, now = Date.now()) {
    this.prune(now);
    return (this.rooms.get(room) ?? []).filter(x => x.sequence > since && x.fromUserId !== userId && x.toUserId === userId);
  }
}
