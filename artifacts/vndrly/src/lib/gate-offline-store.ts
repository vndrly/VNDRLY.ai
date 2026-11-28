import { openWebFleetWorkStorage } from "./fleet-work-journal-web";

/**
 * The Gate with no connection, on this computer: the proof for an offline sign-in, the Gate's last-read data, and
 * the check-ins and check-outs waiting to upload. All of it is kept in the browser's encrypted storage.
 */

/** John, 2026-11-28: an offline sign-in stays good for 30 days after the server last confirmed it on this computer. */
export const OFFLINE_SIGN_IN_MS = 30 * 24 * 60 * 60_000;

export type GateOfflineUser = {
  userId: number;
  activeMembershipId: number | null;
  vendorId: number | null;
  partnerId: number | null;
};
type Storage = Awaited<ReturnType<typeof openWebFleetWorkStorage>>;

const opened = new Map<string, Promise<Storage>>();
function open(identity: string) {
  let storage = opened.get(identity);
  if (!storage) {
    storage = openWebFleetWorkStorage(identity, () => true);
    opened.set(identity, storage);
    storage.catch(() => opened.delete(identity));
  }
  return storage;
}
const identityOf = (user: GateOfflineUser) =>
  `gate-offline:${user.userId}:${user.activeMembershipId ?? 0}:${user.vendorId ?? 0}:${user.partnerId ?? 0}`;
const owned = (user: GateOfflineUser) => open(identityOf(user));

/** Nothing reached the server: no connection, or a connection that never answered. */
export function isGateOffline(error: unknown): boolean {
  const failure = error as { status?: number; name?: string; message?: string } | null;
  if (typeof failure?.status === "number") return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return (
    ["TypeError", "TimeoutError", "AbortError"].includes(failure?.name ?? "") ||
    /failed to fetch|network ?error|fetch failed|network request failed|load failed/i.test(failure?.message ?? "")
  );
}

// ---- The Gate's last-read data -------------------------------------------------------------------------------

const written = new Map<string, { raw: string; at: number }>();

/** Reads from the server; with no connection, answers with what this computer last read (up to 30 days old). */
export async function gateReadWithOfflineFallback<T>(
  user: GateOfflineUser,
  subject: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const memo = `${user.userId}:${user.activeMembershipId}:${subject}`;
  const keep = async (value: string) => (await owned(user)).transaction((tx) => tx.set("read", subject, value));
  try {
    const value = await fetcher();
    const raw = JSON.stringify(value);
    const last = written.get(memo);
    // Unchanged data is rewritten hourly, only to keep its age current.
    if (raw.length <= 2_000_000 && (!last || last.raw !== raw || Date.now() - last.at > 60 * 60_000)) {
      written.set(memo, { raw, at: Date.now() });
      void keep(JSON.stringify({ at: Date.now(), value })).catch(() => written.delete(memo));
    }
    return value;
  } catch (error) {
    if (!isGateOffline(error)) {
      // Refused by the server: what was kept is never served in its place.
      if ([401, 403, 404].includes((error as { status?: number }).status ?? 0)) {
        written.delete(memo);
        void keep("").catch(() => undefined);
      }
      throw error;
    }
    let raw: string | null = null;
    try {
      raw = await (await owned(user)).transaction((tx) => tx.get("read", subject));
    } catch {
      // This browser's storage cannot be read: the failure to reach the server is the one reported.
    }
    const kept = raw ? (JSON.parse(raw) as { at: number; value: T }) : null;
    if (!kept || !(Date.now() - kept.at < OFFLINE_SIGN_IN_MS)) throw error;
    return kept.value;
  }
}

// ---- Check-ins and check-outs waiting to upload --------------------------------------------------------------

export type GateOfflineEntry = {
  operationId: string;
  capturedAt: string;
  payload: {
    siteLocationId: number;
    gateStationId?: string;
    direction: "entry" | "exit";
    plate?: string;
    plateState?: string;
    reportedVisitor?: { firstName: string; lastName: string; company?: string; purpose?: string; notes?: string };
    /** A check-out of a visitor the server already knows. */
    originalVisitId?: number;
    /** A check-out of a check-in that is itself still on this computer. */
    entryOperationId?: string;
  };
  /** Who it is, for the list on this computer. */
  label: string;
  state: "pending" | "conflict" | "revoked" | "failed" | "synced";
  /** Why the server did not take it. */
  reason?: string;
};

const KEPT = "vndrly.gate.offline.kept";
/** True when this browser may hold this person's records. Checked before the encrypted storage is opened. */
export const gateOfflineMayHold = (user: GateOfflineUser) => {
  try { return localStorage.getItem(`${KEPT}:${identityOf(user)}`) === "1"; } catch { return true; }
};
const markKept = (user: GateOfflineUser, kept: boolean) => {
  const key = `${KEPT}:${identityOf(user)}`;
  try { if (kept) localStorage.setItem(key, "1"); else localStorage.removeItem(key); } catch { /* The flag only saves work. */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event("vndrly:gate-offline-changed"));
};
const entriesOf = (values: string[]) =>
  values.filter(Boolean).map((raw) => JSON.parse(raw) as GateOfflineEntry).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

/** Keeps a check-in or check-out on this computer. Throws when the browser cannot store it. */
export async function saveGateOfflineEntry(
  user: GateOfflineUser,
  input: Pick<GateOfflineEntry, "payload" | "label">,
): Promise<GateOfflineEntry> {
  const entry: GateOfflineEntry = { ...input, operationId: crypto.randomUUID(), capturedAt: new Date().toISOString(), state: "pending" };
  await (await owned(user)).transaction((tx) => tx.set("entry", entry.operationId, JSON.stringify(entry)));
  markKept(user, true);
  return entry;
}

/** Every record still on this computer, oldest first. */
export async function listGateOfflineEntries(user: GateOfflineUser): Promise<GateOfflineEntry[]> {
  return entriesOf(await (await owned(user)).transaction((tx) => tx.values("entry")));
}

/** Puts a refused record back in line, after access is restored. */
export async function retryGateOfflineEntry(user: GateOfflineUser, operationId: string) {
  await (await owned(user)).transaction(async (tx) => {
    const raw = await tx.get("entry", operationId);
    const entry = raw ? (JSON.parse(raw) as GateOfflineEntry) : null;
    if (!entry || !["revoked", "failed"].includes(entry.state)) return;
    await tx.set("entry", operationId, JSON.stringify({ ...entry, state: "pending", reason: undefined }));
  });
  markKept(user, true);
}

const uploads = new Map<Storage, Promise<GateOfflineEntry[]>>();

/**
 * Uploads what is waiting, oldest first, each under its own operation id so a repeat is never a second visit.
 * A record the server will not take stays on this computer with the reason; it is never dropped.
 */
export async function uploadGateOfflineEntries(
  user: GateOfflineUser,
  send: (entry: GateOfflineEntry) => Promise<unknown>,
): Promise<GateOfflineEntry[]> {
  const storage = await owned(user);
  const running = uploads.get(storage);
  if (running) return running;
  const put = (entry: GateOfflineEntry | null, operationId: string) =>
    storage.transaction((tx) => tx.set("entry", operationId, entry ? JSON.stringify(entry) : ""));
  const work = (async () => {
    const waiting = (await listGateOfflineEntries(user)).filter((entry) => entry.state === "pending");
    const unsent = new Set(waiting.map((entry) => entry.operationId));
    for (const entry of waiting) {
      // A check-out of a check-in still on this computer waits for that check-in.
      if (entry.payload.entryOperationId && unsent.has(entry.payload.entryOperationId)) continue;
      try {
        await send(entry);
        unsent.delete(entry.operationId);
        // A check-in stays, sent, while a check-out on this computer still points at it.
        await put(entry.payload.direction === "entry" ? { ...entry, state: "synced" } : null, entry.operationId);
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (!status || status >= 500 || status === 408 || status === 429) break;
        await put({
          ...entry,
          state: status === 409 || status === 412 ? "conflict" : status === 401 || status === 403 ? "revoked" : "failed",
          reason: (error as { message?: string }).message || undefined,
        }, entry.operationId);
      }
    }
    const kept = await listGateOfflineEntries(user);
    const linked = new Set(kept.map((entry) => entry.payload.entryOperationId));
    for (const entry of kept)
      if (entry.state === "synced" && !linked.has(entry.operationId)) await put(null, entry.operationId);
    const left = kept.filter((entry) => entry.state !== "synced" || linked.has(entry.operationId));
    markKept(user, left.length > 0);
    return left;
  })();
  uploads.set(storage, work);
  void work.catch(() => undefined).finally(() => { if (uploads.get(storage) === work) uploads.delete(storage); });
  return work;
}

// ---- Offline sign-in -----------------------------------------------------------------------------------------

type Remembered<User> = { salt: string; proof: string; at: number; user: User };
const SIGN_IN = "gate-offline-sign-in";
const hex = (value: ArrayBuffer) => Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
const text = (value: string) => new TextEncoder().encode(value);
const name = (username: string) => username.trim().toLowerCase();
const slot = async (username: string) => hex(await crypto.subtle.digest("SHA-256", text(name(username))));
/** A slow salted proof of the password. The password itself is never stored. */
async function proofOf(salt: string, username: string, password: string) {
  const key = await crypto.subtle.importKey("raw", text(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: text(`${salt}\n${name(username)}`), iterations: 210_000 },
    key,
    256,
  ));
}
/** The password typed for an offline sign-in, held in memory only, so the real sign-in happens when the connection returns. */
let held: { username: string; password: string } | null = null;
export const heldGateSignIn = () => held;
export const forgetGatePassword = () => { held = null; };

/** After the server accepts a sign-in: this computer may repeat it with no connection for 30 days. */
export async function rememberGateSignIn<User extends { mustChangePassword?: boolean }>(username: string, password: string, user: User) {
  if (user.mustChangePassword) return;
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const record: Remembered<User> = { salt, proof: await proofOf(salt, username, password), at: Date.now(), user };
  const key = await slot(username);
  await (await open(SIGN_IN)).transaction(async (tx) => {
    await tx.set("sign-in", key, JSON.stringify(record));
    await tx.set("current", "slot", key);
  });
}

/** The server confirmed the session again: the 30 days start over and the kept profile is brought up to date. */
export async function confirmGateSignIn<User extends { userId: number }>(user: User) {
  await (await open(SIGN_IN)).transaction(async (tx) => {
    const key = await tx.get("current", "slot");
    const raw = key ? await tx.get("sign-in", key) : null;
    const record = raw ? (JSON.parse(raw) as Remembered<User>) : null;
    if (key && record?.user.userId === user.userId) await tx.set("sign-in", key, JSON.stringify({ ...record, at: Date.now(), user }));
  });
}

/** The username and password, checked on this computer. Null when they were not accepted here in the last 30 days. */
export async function offlineGateSignIn<User>(username: string, password: string): Promise<User | null> {
  const key = await slot(username);
  const raw = await (await open(SIGN_IN)).transaction((tx) => tx.get("sign-in", key));
  const record = raw ? (JSON.parse(raw) as Remembered<User>) : null;
  if (!record || !(Date.now() - record.at < OFFLINE_SIGN_IN_MS)) return null;
  if ((await proofOf(record.salt, username, password)) !== record.proof) return null;
  held = { username, password };
  await (await open(SIGN_IN)).transaction((tx) => tx.set("current", "slot", key));
  return record.user;
}

/** Who was signed in on this computer when the connection was lost, if the server confirmed them in the last 30 days. */
export async function retainedGateSignIn<User>(): Promise<User | null> {
  const raw = await (await open(SIGN_IN)).transaction(async (tx) => {
    const key = await tx.get("current", "slot");
    return key ? tx.get("sign-in", key) : null;
  });
  const record = raw ? (JSON.parse(raw) as Remembered<User>) : null;
  return record && Date.now() - record.at < OFFLINE_SIGN_IN_MS ? record.user : null;
}

/**
 * Signed out, or refused by the server: nobody is restored on this computer without the password.
 * `refused` is for a password the server no longer accepts: it stops working here with no connection too.
 */
export async function releaseGateSignIn(refused = false) {
  held = null;
  await (await open(SIGN_IN)).transaction(async (tx) => {
    const key = await tx.get("current", "slot");
    if (refused && key) await tx.set("sign-in", key, "");
    await tx.set("current", "slot", "");
  });
}
