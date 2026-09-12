import { createHash, randomBytes } from "node:crypto";

const LEASE_TTL_MS = 20_000;
const OFFER_TTL_MS = 30_000;
const FAILOVER_WARNING_MS = 3_000;
const CONNECTION_TTL_MS = 45_000;

export type AudioLeaseActor = { occurrenceId: string; userId: number; deviceId: string; hostMuted?: boolean };
export type AudioLeaseRecord = {
  occurrenceId: string; userId: number; deviceId: string; generation: number; tokenHash: string;
  state: "active" | "source_lost"; expiresAt: Date; updatedAt: Date;
  pendingDeviceId: string | null; offerTokenHash: string | null; offerExpiresAt: Date | null;
};
export type AudioLeaseStore = {
  transact<T>(occurrenceId: string, userId: number, change: (current: AudioLeaseRecord | null) => { record: AudioLeaseRecord; value: T } | Promise<{ record: AudioLeaseRecord; value: T }>): Promise<T>;
  read(occurrenceId: string, userId: number): Promise<AudioLeaseRecord | null>;
};

export class AudioLeaseError extends Error {
  constructor(readonly code: "meeting.host_muted" | "audio.in_use" | "audio.invalid_lease" | "audio.invalid_offer" | "audio.failover_warning", message: string) { super(message); this.name = "AudioLeaseError"; }
}

const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const keyOf = (occurrenceId: string, userId: number) => `${occurrenceId}:${userId}`;

export class InMemoryAudioLeaseStore implements AudioLeaseStore {
  private readonly rows = new Map<string, AudioLeaseRecord>();
  private readonly tails = new Map<string, Promise<void>>();
  async transact<T>(occurrenceId: string, userId: number, change: (current: AudioLeaseRecord | null) => { record: AudioLeaseRecord; value: T } | Promise<{ record: AudioLeaseRecord; value: T }>) {
    const key = keyOf(occurrenceId, userId);
    const prior = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>(resolve => { release = resolve; });
    const queued = prior.then(() => tail);
    this.tails.set(key, queued);
    await prior;
    try { const next = await change(this.rows.get(key) ?? null); this.rows.set(key, next.record); return next.value; }
    finally { release(); if (this.tails.get(key) === queued) this.tails.delete(key); }
  }
  async read(occurrenceId: string, userId: number) { return this.rows.get(keyOf(occurrenceId, userId)) ?? null; }
}

export function createAudioLeaseService(store: AudioLeaseStore, options: { now?: () => Date; token?: () => string } = {}) {
  const now = options.now ?? (() => new Date());
  const token = options.token ?? (() => randomBytes(32).toString("base64url"));
  const requireValid = (current: AudioLeaseRecord | null, actor: AudioLeaseActor, rawToken: string, generation?: number) => {
    const clock = now();
    if (!current || current.deviceId !== actor.deviceId || current.tokenHash !== digest(rawToken) || current.state !== "active" || current.expiresAt <= clock || (generation !== undefined && current.generation !== generation)) throw new AudioLeaseError("audio.invalid_lease", "Audio ownership expired or moved to another device");
    return { current, clock };
  };
  return {
    async acquire(actor: AudioLeaseActor) {
      if (actor.hostMuted) throw new AudioLeaseError("meeting.host_muted", "Muted by the meeting host");
      return store.transact(actor.occurrenceId, actor.userId, current => {
        const clock = now();
        if (current?.state === "active" && current.expiresAt > clock && current.deviceId !== actor.deviceId) throw new AudioLeaseError("audio.in_use", "Audio is active on another device");
        const rawToken = token(); const generation = (current?.generation ?? 0) + 1;
        const record: AudioLeaseRecord = { occurrenceId: actor.occurrenceId, userId: actor.userId, deviceId: actor.deviceId, generation, tokenHash: digest(rawToken), state: "active", expiresAt: new Date(clock.getTime() + LEASE_TTL_MS), updatedAt: clock, pendingDeviceId: null, offerTokenHash: null, offerExpiresAt: null };
        return { record, value: { token: rawToken, generation, expiresAt: record.expiresAt } };
      });
    },
    async renew(actor: AudioLeaseActor, rawToken: string, generation: number) {
      if (actor.hostMuted) throw new AudioLeaseError("meeting.host_muted", "Muted by the meeting host");
      return store.transact(actor.occurrenceId, actor.userId, current => { const valid = requireValid(current, actor, rawToken, generation); const record = { ...valid.current, expiresAt: new Date(valid.clock.getTime() + LEASE_TTL_MS), updatedAt: valid.clock }; return { record, value: { generation: record.generation, expiresAt: record.expiresAt } }; });
    },
    async offerHandoff(actor: AudioLeaseActor, rawToken: string, destinationDeviceId: string) {
      return store.transact(actor.occurrenceId, actor.userId, current => { const valid = requireValid(current, actor, rawToken); if (destinationDeviceId === actor.deviceId) throw new AudioLeaseError("audio.invalid_offer", "Choose another device"); const offerToken = token(); const record = { ...valid.current, pendingDeviceId: destinationDeviceId, offerTokenHash: digest(offerToken), offerExpiresAt: new Date(valid.clock.getTime() + OFFER_TTL_MS), updatedAt: valid.clock }; return { record, value: { offerToken, destinationDeviceId, expiresAt: record.offerExpiresAt } }; });
    },
    async requestHandoff(actor: AudioLeaseActor) {
      return store.transact(actor.occurrenceId, actor.userId, current => {
        const clock = now();
        if (!current || current.state !== "active" || current.expiresAt <= clock || current.deviceId === actor.deviceId) throw new AudioLeaseError("audio.invalid_offer", "Audio is already available on this device");
        const record = { ...current, pendingDeviceId: actor.deviceId, offerTokenHash: null, offerExpiresAt: new Date(clock.getTime() + OFFER_TTL_MS), updatedAt: clock };
        return { record, value: { destinationDeviceId: actor.deviceId, expiresAt: record.offerExpiresAt } };
      });
    },
    async acceptHandoff(actor: AudioLeaseActor, offerToken?: string) {
      if (actor.hostMuted) throw new AudioLeaseError("meeting.host_muted", "Muted by the meeting host");
      return store.transact(actor.occurrenceId, actor.userId, current => { const clock = now(); if (!current || current.pendingDeviceId !== actor.deviceId || (current.offerTokenHash && (!offerToken || current.offerTokenHash !== digest(offerToken))) || !current.offerExpiresAt || current.offerExpiresAt <= clock) throw new AudioLeaseError("audio.invalid_offer", "Audio handoff offer expired"); const rawToken = token(); const record: AudioLeaseRecord = { ...current, deviceId: actor.deviceId, generation: current.generation + 1, tokenHash: digest(rawToken), state: "active", expiresAt: new Date(clock.getTime() + LEASE_TTL_MS), updatedAt: clock, pendingDeviceId: null, offerTokenHash: null, offerExpiresAt: null }; return { record, value: { token: rawToken, generation: record.generation, expiresAt: record.expiresAt } }; });
    },
    async cancelHandoff(actor: AudioLeaseActor, rawToken: string) { return store.transact(actor.occurrenceId, actor.userId, current => { const valid = requireValid(current, actor, rawToken); const record = { ...valid.current, pendingDeviceId: null, offerTokenHash: null, offerExpiresAt: null, updatedAt: valid.clock }; return { record, value: { cancelled: true } }; }); },
    async declineHandoff(actor: AudioLeaseActor) {
      return store.transact(actor.occurrenceId, actor.userId, current => {
        const clock = now();
        if (!current || current.pendingDeviceId !== actor.deviceId || !current.offerExpiresAt || current.offerExpiresAt <= clock) throw new AudioLeaseError("audio.invalid_offer", "Audio handoff offer expired");
        const record = { ...current, pendingDeviceId: null, offerTokenHash: null, offerExpiresAt: null, updatedAt: clock };
        return { record, value: { declined: true } };
      });
    },
    async release(actor: AudioLeaseActor, rawToken: string, generation: number) {
      return store.transact(actor.occurrenceId, actor.userId, current => {
        const valid = requireValid(current, actor, rawToken, generation);
        const record: AudioLeaseRecord = { ...valid.current, state: "source_lost", expiresAt: valid.clock, updatedAt: valid.clock, pendingDeviceId: null, offerTokenHash: null, offerExpiresAt: null };
        return { record, value: { released: true, generation: record.generation } };
      });
    },
    async fence(occurrenceId: string, userId: number) {
      return store.transact(occurrenceId, userId, current => {
        if (!current) throw new AudioLeaseError("audio.invalid_lease", "No audio ownership exists");
        const clock = now();
        const record: AudioLeaseRecord = { ...current, generation: current.generation + 1, state: "source_lost", expiresAt: clock, updatedAt: clock, pendingDeviceId: null, offerTokenHash: null, offerExpiresAt: null };
        return { record, value: { fenced: true, generation: record.generation } };
      });
    },
    async prepareFailover(actor: AudioLeaseActor, expectedGeneration: number) {
      if (actor.hostMuted) throw new AudioLeaseError("meeting.host_muted", "Muted by the meeting host");
      return store.transact(actor.occurrenceId, actor.userId, current => {
        const clock = now();
        if (!current || current.generation !== expectedGeneration || (current.state === "active" && current.expiresAt > clock)) throw new AudioLeaseError("audio.in_use", "Audio is still active on another device");
        const readyAt = new Date(clock.getTime() + FAILOVER_WARNING_MS);
        const record: AudioLeaseRecord = { ...current, state: "source_lost", expiresAt: clock, pendingDeviceId: actor.deviceId, offerTokenHash: null, offerExpiresAt: readyAt, updatedAt: clock };
        return { record, value: { expectedGeneration, readyAt } };
      });
    },
    async cancelFailover(actor: AudioLeaseActor, expectedGeneration: number) {
      return store.transact(actor.occurrenceId, actor.userId, current => {
        const clock = now();
        if (!current || current.generation !== expectedGeneration || current.pendingDeviceId !== actor.deviceId || current.state !== "source_lost") throw new AudioLeaseError("audio.invalid_offer", "No failover warning is active on this device");
        const record = { ...current, pendingDeviceId: null, offerTokenHash: null, offerExpiresAt: null, updatedAt: clock };
        return { record, value: { cancelled: true } };
      });
    },
    async activateFailover(actor: AudioLeaseActor, expectedGeneration: number) {
      if (actor.hostMuted) throw new AudioLeaseError("meeting.host_muted", "Muted by the meeting host");
      return store.transact(actor.occurrenceId, actor.userId, current => {
        const clock = now();
        if (!current || current.generation !== expectedGeneration || (current.state === "active" && current.expiresAt > clock)) throw new AudioLeaseError("audio.in_use", "Audio is still active on another device");
        if (current.pendingDeviceId !== actor.deviceId || !current.offerExpiresAt) throw new AudioLeaseError("audio.invalid_offer", "Start the failover warning before activating audio");
        if (current.offerExpiresAt > clock) throw new AudioLeaseError("audio.failover_warning", "The failover warning is still active");
        const rawToken = token();
        const record: AudioLeaseRecord = { ...current, deviceId: actor.deviceId, generation: current.generation + 1, tokenHash: digest(rawToken), state: "active", expiresAt: new Date(clock.getTime() + LEASE_TTL_MS), updatedAt: clock, pendingDeviceId: null, offerTokenHash: null, offerExpiresAt: null };
        return { record, value: { token: rawToken, generation: record.generation, expiresAt: record.expiresAt } };
      });
    },
    async validate(actor: AudioLeaseActor, rawToken: string, generation: number) { const current = await store.read(actor.occurrenceId, actor.userId); try { requireValid(current, actor, rawToken, generation); return true; } catch { return false; } },
    async state(occurrenceId: string, userId: number) {
      const current = await store.read(occurrenceId, userId); const clock = now();
      if (!current) return null;
      return { deviceId: current.deviceId, generation: current.generation, active: current.state === "active" && current.expiresAt > clock, expiresAt: current.expiresAt, pendingDeviceId: current.offerExpiresAt && current.offerExpiresAt > clock ? current.pendingDeviceId : null };
    },
  };
}

export type FailoverDevice = { deviceId: string; connectionId: string; seenAt: number; microphonePermission: "unknown" | "granted" | "denied" };
export function selectFailoverCandidate(devices: FailoverDevice[], preferences: { rankedDeviceIds: string[]; automaticBackupDeviceIds: string[] }, now = Date.now()) {
  const authorized = new Set(preferences.automaticBackupDeviceIds);
  const eligible = new Map(devices.filter(value => value.seenAt >= now - CONNECTION_TTL_MS && value.microphonePermission === "granted" && authorized.has(value.deviceId)).map(value => [value.deviceId, value]));
  for (const deviceId of preferences.rankedDeviceIds) { const device = eligible.get(deviceId); if (device) return device; }
  return devices.find(value => eligible.has(value.deviceId)) ?? null;
}
