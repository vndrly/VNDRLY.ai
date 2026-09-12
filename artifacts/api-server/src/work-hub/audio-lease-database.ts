import { and, eq, sql } from "drizzle-orm";
import { db, workHubAudioLeasesTable } from "@workspace/db";
import { createAudioLeaseService, type AudioLeaseRecord, type AudioLeaseStore } from "./audio-lease";

function mapRow(row: typeof workHubAudioLeasesTable.$inferSelect): AudioLeaseRecord {
  return {
    occurrenceId: row.occurrenceId, userId: row.userId, deviceId: row.deviceId,
    generation: row.generation, tokenHash: row.tokenHash,
    state: row.state === "source_lost" ? "source_lost" : "active",
    expiresAt: row.expiresAt, updatedAt: row.updatedAt,
    pendingDeviceId: row.pendingDeviceId, offerTokenHash: row.offerTokenHash,
    offerExpiresAt: row.offerExpiresAt,
  };
}

export const databaseAudioLeaseStore: AudioLeaseStore = {
  async transact(occurrenceId, userId, change) {
    return db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${occurrenceId}:${userId}`}))`);
      const [row] = await tx.select().from(workHubAudioLeasesTable).where(and(eq(workHubAudioLeasesTable.occurrenceId, occurrenceId), eq(workHubAudioLeasesTable.userId, userId))).for("update").limit(1);
      const next = await change(row ? mapRow(row) : null);
      const values = next.record;
      await tx.insert(workHubAudioLeasesTable).values(values).onConflictDoUpdate({
        target: [workHubAudioLeasesTable.occurrenceId, workHubAudioLeasesTable.userId],
        set: { deviceId: values.deviceId, generation: values.generation, tokenHash: values.tokenHash, state: values.state, expiresAt: values.expiresAt, pendingDeviceId: values.pendingDeviceId, offerTokenHash: values.offerTokenHash, offerExpiresAt: values.offerExpiresAt, updatedAt: values.updatedAt },
      });
      return next.value;
    });
  },
  async read(occurrenceId, userId) {
    const [row] = await db.select().from(workHubAudioLeasesTable).where(and(eq(workHubAudioLeasesTable.occurrenceId, occurrenceId), eq(workHubAudioLeasesTable.userId, userId))).limit(1);
    return row ? mapRow(row) : null;
  },
};

export const audioLeaseService = createAudioLeaseService(databaseAudioLeaseStore);

export async function fenceAudioLeasesForDevice(deviceId: string) {
  const clock = new Date();
  return db.update(workHubAudioLeasesTable).set({
    generation: sql`${workHubAudioLeasesTable.generation} + 1`,
    state: "source_lost", expiresAt: clock, updatedAt: clock,
    pendingDeviceId: null, offerTokenHash: null, offerExpiresAt: null,
  }).where(and(eq(workHubAudioLeasesTable.deviceId, deviceId), eq(workHubAudioLeasesTable.state, "active")));
}
