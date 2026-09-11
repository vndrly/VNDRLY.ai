import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import type { QueueStore } from "./work-hub-queue";

const DATABASE_NAME = "vndrly-work-hub-queue.db";
const DATABASE_KEY_NAME = "vndrly.workHub.queue.databaseKey.v1";
let storePromise: Promise<QueueStore> | null = null;

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function databaseKey() {
  const existing = await SecureStore.getItemAsync(DATABASE_KEY_NAME);
  if (existing && /^[0-9a-f]{64}$/i.test(existing)) return existing.toLowerCase();
  const generated = toHex(await Crypto.getRandomBytesAsync(32));
  await SecureStore.setItemAsync(DATABASE_KEY_NAME, generated, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return generated;
}

async function initializeDatabase(): Promise<SQLiteDatabase> {
  const key = await databaseKey();
  const database = await openDatabaseAsync(DATABASE_NAME);
  // SQLCipher requires the key to be the first statement on a new connection.
  // It is generated locally and restricted to hex, so it cannot alter SQL.
  await database.execAsync(`PRAGMA key = "x'${key}'";`);
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS work_hub_queue_store (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return database;
}

export function getNativeWorkHubQueueStore(): Promise<QueueStore> {
  if (!storePromise) {
    storePromise = initializeDatabase().then((database) => ({
      async getItem(key: string) {
        const row = await database.getFirstAsync<{ value: string }>(
          "SELECT value FROM work_hub_queue_store WHERE key = ? LIMIT 1",
          key,
        );
        return row?.value ?? null;
      },
      async setItem(key: string, value: string) {
        await database.runAsync(
          `INSERT INTO work_hub_queue_store (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
          key,
          value,
        );
      },
    }));
    storePromise.catch(() => { storePromise = null; });
  }
  return storePromise;
}

export function __resetNativeWorkHubQueueForTests() {
  storePromise = null;
}
