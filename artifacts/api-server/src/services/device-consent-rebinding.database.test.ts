import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";

const isolated = process.env.VNDRLY_TEST_DB_MODE === "fresh-local" && process.env.VNDRLY_ISOLATED_TEST_DB === "1";
it.skipIf(!isolated)("registers a shared iPhone concurrently for its next account and preserves only that account's original consent", async () => {
  assertFreshLocalTestDatabaseEnvironment(process.env);
  const { db, pool, vendorsTable, usersTable, userOrgMembershipsTable, workHubDevicesTable, locationConsentsTable } = await import("@workspace/db");
  const { deviceCoordinator } = await import("../work-hub/device-coordinator");
  const { rebindOwnDeviceConsent, revokeOwnDeviceConsent } = await import("./device-consent-rebinding");
  const { nativeOperationsService, withNativeLocationCollection } = await import("./native-operations");
  const { initialNativeState } = await import("./native-operations-policy");
  const marker = randomUUID(), installation = randomUUID();
  const [vendor] = await db.insert(vendorsTable).values({ name: `Shared iPhone ${marker}`, contactName: "Synthetic", contactEmail: `${marker}@example.invalid` }).returning();
  const [first, second] = await db.insert(usersTable).values([0, 1].map(n => ({ username: `shared-${n}-${marker}`, displayName: `Synthetic shared-device user ${n}`, passwordHash: "unusable-synthetic", role: "field_employee" as const }))).returning();
  await db.insert(userOrgMembershipsTable).values([first!, second!].map(u => ({ userId: u.id, orgType: "vendor" as const, vendorId: vendor!.id, role: "field_employee" as const })));
  const old = (await db.insert(workHubDevicesTable).values({ id: installation, userId: first!.id, ownerOrgType: "vendor", ownerOrgId: vendor!.id, friendlyName: "Previous user phone", deviceClass: "phone", capabilities: {} }).returning())[0]!;
  const acceptedAt = new Date("2026-10-18T07:14:50.878Z");
  const original = await db.insert(locationConsentsTable).values([first!, second!].map(u => ({ userId: u.id, deviceId: installation, acceptedAt }))).returning();
  const actor = { userId: second!.id, owner: { type: "vendor" as const, id: vendor!.id } };
  const input = { deviceId: installation, separateAccount: true, friendlyName: "Shared iPhone", deviceClass: "phone", capabilities: {} };
  const [registered, retried] = await Promise.all([deviceCoordinator.registerDevice(actor, input), deviceCoordinator.registerDevice(actor, input)]);
  expect(registered.id).not.toBe(installation); expect(retried.id).toBe(registered.id);
  const session = { userId: second!.id, vendorId: vendor!.id, role: "field_employee", sv: 1 };
  expect(await rebindOwnDeviceConsent(session, installation, registered.id)).toEqual({ inherited: true });
  expect(await rebindOwnDeviceConsent(session, installation, registered.id)).toEqual({ inherited: true });
  const rows = (await pool.query("SELECT id,user_id,device_id,original_device_id,accepted_at,revoked_at FROM location_consents WHERE user_id IN($1,$2) ORDER BY user_id", [first!.id, second!.id])).rows;
  expect(rows).toHaveLength(3);
  expect(rows.find(r => r.user_id === first!.id)).toMatchObject({ device_id: installation, accepted_at: acceptedAt, revoked_at: null });
  expect(rows.find(r => r.id === original.find(c => c.userId === second!.id)!.id)).toMatchObject({ device_id: installation, accepted_at: acceptedAt, revoked_at: null });
  expect(rows.find(r => r.device_id === registered.id)).toMatchObject({ user_id: second!.id, original_device_id: installation, accepted_at: acceptedAt, revoked_at: null });
  expect((await deviceCoordinator.listDevices({ userId: first!.id, owner: actor.owner }))[0]).toMatchObject({ id: old.id, friendlyName: old.friendlyName });
  const state = initialNativeState(); state.consent.locationSharing = true; state.duty = { ...state.duty, active: true, mode: "manual", startedAt: new Date().toISOString() };
  await pool.query("INSERT INTO work_hub_device_preferences(user_id,owner_org_type,owner_org_id,native_operations) VALUES($1,'vendor',$2,$3::jsonb)", [second!.id, vendor!.id, JSON.stringify(state)]);
  const native = await nativeOperationsService.device(session, registered.id);
  expect(native.designatedDeviceId).toBe(registered.id);
  expect(await withNativeLocationCollection(session, registered.id, async () => "software-authority-verified")).toBe("software-authority-verified");
  await expect(withNativeLocationCollection(session, installation, async () => "wrong-phone")).rejects.toMatchObject({ code: "native.work_phone_changed" });
  // A -> B -> A within one user keeps the first organization's agreement.
  const [nextVendor] = await db.insert(vendorsTable).values({ name: `Other shared company ${marker}`, contactName: "Synthetic", contactEmail: `other-${marker}@example.invalid` }).returning();
  await db.insert(userOrgMembershipsTable).values({ userId: second!.id, orgType: "vendor", vendorId: nextVendor!.id, role: "field_employee" });
  const nextActor = { userId: second!.id, owner: { type: "vendor" as const, id: nextVendor!.id } };
  const nextRegistration = await deviceCoordinator.registerDevice(nextActor, input);
  expect(await rebindOwnDeviceConsent({ ...session, vendorId: nextVendor!.id }, installation, nextRegistration.id)).toEqual({ inherited: true });
  expect((await deviceCoordinator.registerDevice(actor, input)).id).toBe(registered.id);
  expect((await pool.query("SELECT count(*)::int AS count FROM location_consents WHERE user_id=$1 AND revoked_at IS NULL", [second!.id])).rows[0].count).toBe(3);
  const raceRegistration = await deviceCoordinator.registerDevice(actor, { friendlyName: "Synthetic pending alias", deviceClass: "phone", capabilities: {} });
  // Model an in-flight native operation holding the same lock as designation/duty saves.
  const writer = await pool.connect();
  let blockedByWriter = false;
  try {
    await writer.query("BEGIN");
    await writer.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`native:${vendor!.id}:${second!.id}`]);
    const pid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const stale = (await writer.query("SELECT native_operations FROM work_hub_device_preferences WHERE user_id=$1 AND owner_org_type='vendor' AND owner_org_id=$2", [second!.id, vendor!.id])).rows[0].native_operations;
    expect(stale.consent.locationSharing).toBe(true);
    let finished = false;
    const pending = Promise.all([rebindOwnDeviceConsent(session, installation, raceRegistration.id), revokeOwnDeviceConsent(session, installation)]).finally(() => { finished = true; });
    for (let attempt = 0; attempt < 100 && !finished; attempt++) {
      blockedByWriter = (await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked", [pid])).rows[0].blocked;
      if (blockedByWriter) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await writer.query("UPDATE work_hub_device_preferences SET native_operations=$3::jsonb WHERE user_id=$1 AND owner_org_type='vendor' AND owner_org_id=$2", [second!.id, vendor!.id, JSON.stringify(stale)]);
    await writer.query("COMMIT");
    await pending;
  } finally { await writer.query("ROLLBACK"); writer.release(); }
  expect(blockedByWriter).toBe(true);
  expect((await pool.query("SELECT native_operations FROM work_hub_device_preferences WHERE user_id=$1 AND owner_org_type='vendor' AND owner_org_id=$2", [second!.id, vendor!.id])).rows[0].native_operations.consent.locationSharing).toBe(false);
  expect((await pool.query("SELECT count(*)::int AS count FROM location_consents WHERE user_id=$1 AND revoked_at IS NULL", [second!.id])).rows[0].count).toBe(0);
  await expect(withNativeLocationCollection(session, registered.id, async () => "consent-revoked")).rejects.toMatchObject({ status: 403 });
  expect((await pool.query("SELECT count(*)::int AS count FROM location_consents WHERE user_id=$1 AND revoked_at IS NULL", [first!.id])).rows[0].count).toBe(1);
  await deviceCoordinator.revokeDevice(actor, registered.id);
  await expect(deviceCoordinator.registerDevice(actor, input)).rejects.toMatchObject({ code: "work_hub.not_found" });
  await expect(withNativeLocationCollection(session, registered.id, async () => "revoked")).rejects.toMatchObject({ status: 403 });
});
