import { randomUUID } from "node:crypto";
import type { QueryConfig } from "pg";
import { describe, expect, it } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";

const isolated = process.env.VNDRLY_TEST_DB_MODE === "fresh-local" && process.env.VNDRLY_ISOLATED_TEST_DB === "1";
if (isolated) assertFreshLocalTestDatabaseEnvironment(process.env);

describe.skipIf(!isolated)("Gate assignment PostgreSQL boundary", () => {
  it("serializes exact replay, checks current verified requirements and refuses foreign company or revoked contract", async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const s = await import("@workspace/db");
    const { eq, and } = await import("drizzle-orm");
    const { executeGateShiftAssignment, readGateShiftAssignment, readShiftCreationOperation, lockShiftSchedulingRows } = await import("./gate-shift-assignment");
    const target = new URL(process.env.DATABASE_URL!);
    expect((await s.pool.query("SELECT current_database() AS database,host(inet_server_addr()) AS address,inet_server_port() AS port")).rows[0]).toEqual({ database: process.env.VNDRLY_FRESH_TEST_DB_NAME, address: "127.0.0.1", port: Number(target.port) });
    const marker = randomUUID();
    const [vendor] = await s.db.insert(s.vendorsTable).values({ name: `Synthetic Gate ${marker}`, contactName: "Synthetic", contactEmail: `${marker}@example.invalid` }).returning();
    const [partner] = await s.db.insert(s.partnersTable).values({ name: `Synthetic Gate partner ${marker}`, contactName: "Synthetic", contactEmail: `p.${marker}@example.invalid` }).returning();
    const [site] = await s.db.insert(s.siteLocationsTable).values({ partnerId: partner.id, name: `Synthetic Gate ${marker}`, address: "Isolated fixture", latitude: 30, longitude: -100, siteCode: `G-${marker}` }).returning();
    const [station] = await s.db.insert(s.gateStationsTable).values({ siteId: site.id, name: "Synthetic gate" }).returning();
    const [workType] = await s.db.insert(s.workTypesTable).values({ name: `Synthetic Gate ${marker}`, category: "gate" }).returning();
    await s.db.insert(s.siteWorkAssignmentsTable).values({ siteLocationId: site.id, vendorId: vendor.id, workTypeId: workType.id, isGateContractor: true });
    const [relationship] = await s.db.insert(s.partnerVendorRelationshipsTable).values({ partnerId: partner.id, vendorId: vendor.id, status: "approved" }).returning();
    const [admin, worker] = await s.db.insert(s.usersTable).values([
      { username: `gate-admin-${marker}`, passwordHash: "synthetic-unusable-login", role: "vendor", displayName: "Synthetic scheduler" },
      { username: `gate-worker-${marker}`, passwordHash: "synthetic-unusable-login", role: "field_employee", displayName: "Synthetic Gate worker" },
    ]).returning();
    const [person] = await s.db.insert(s.vendorPeopleTable).values({ vendorId: vendor.id, userId: worker.id, firstName: "Synthetic", lastName: "Gate worker", email: `w.${marker}@example.invalid`, vendorRole: "gatekeeper" }).returning();
    await s.db.insert(s.vendorPersonSiteAccessTable).values({ vendorPeopleId: person.id, siteLocationId: site.id });
    const [membership] = await s.db.insert(s.userOrgMembershipsTable).values({ userId: admin.id, orgType: "vendor", vendorId: vendor.id, role: "admin" }).returning();
    await s.db.insert(s.userOrgMembershipsTable).values({ userId: worker.id, orgType: "vendor", vendorId: vendor.id, vendorPeopleId: person.id, role: "member" });
    const session = { userId: admin.id, role: "vendor", vendorId: vendor.id, membershipRole: "admin", activeMembershipId: membership.id, sv: admin.sessionVersion };
    const startsAt = new Date(Date.now() + 86400000 * 30), endsAt = new Date(startsAt.getTime() + 4 * 3600000);
    await s.db.insert(s.workHubAvailabilityTable).values({ ownerOrgType: "vendor", ownerOrgId: vendor.id, userId: worker.id, startsAt, endsAt, available: true });
    const [shift] = await s.db.insert(s.workHubShiftsTable).values({ ownerOrgType: "vendor", ownerOrgId: vendor.id, title: "Synthetic Gate assignment", startsAt, endsAt, timezone: "UTC", siteLocationId: site.id, gateStationId: station.id, requiredStaffCount: 1, workStartPolicy: "on_site", qualificationCodes: null, createdById: admin.id }).returning();
    const input = { operationId: randomUUID(), expectedVersion: 1, assigneeUserIds: [worker.id] };
    await expect(executeGateShiftAssignment(session, shift.id, input)).rejects.toThrow("configuration_unknown");
    await s.db.update(s.workHubShiftsTable).set({ qualificationCodes: ["Site training"] }).where(eq(s.workHubShiftsTable.id, shift.id));
    const [cert] = await s.db.insert(s.employeeCertificationsTable).values({ employeeId: person.id, name: "Site training", expirationDate: "2099-12-31" }).returning();
    await expect(executeGateShiftAssignment(session, shift.id, input)).rejects.toThrow("qualification_required");
    await s.db.update(s.employeeCertificationsTable).set({ vendorVerifiedAt: new Date(), vendorVerifiedByUserId: admin.id }).where(eq(s.employeeCertificationsTable.id, cert.id));
    const [first, second] = await Promise.all([executeGateShiftAssignment(session, shift.id, input), executeGateShiftAssignment(session, shift.id, input)]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ previousVersion: 1, resultingVersion: 2, assigneeUserIds: [worker.id], physicalAttendanceVerified: false });
    expect((await readGateShiftAssignment(session, shift.id, input.operationId)).receipt).toEqual(first);
    expect(await s.db.select().from(s.workHubShiftAssignmentsTable).where(eq(s.workHubShiftAssignmentsTable.shiftId, shift.id))).toHaveLength(1);
    expect(await s.db.select().from(s.workHubClientOperationsTable).where(and(eq(s.workHubClientOperationsTable.userId, admin.id), eq(s.workHubClientOperationsTable.operationId, input.operationId)))).toHaveLength(1);
    await expect(executeGateShiftAssignment(session, shift.id, {...input,assigneeUserIds:[]})).rejects.toThrow("operation_conflict");
    const creationId=randomUUID();
    await s.db.insert(s.workHubClientOperationsTable).values({userId:admin.id,commandKind:"shift.create",operationId:creationId,ownerOrgType:"vendor",ownerOrgId:vendor.id,resultJson:{...shift,assigneeUserIds:[worker.id]},appliedAt:new Date()});
    // Hold recovery's first user lock while assignment reaches its user lock. With the old
    // shift-first writer, releasing this barrier produces the actual users/shift cycle.
    let releaseReader!:()=>void, readerLocked!:()=>void, writerWaiting!:()=>void;
    const release=new Promise<void>(resolve=>{releaseReader=resolve;});
    const locked=new Promise<void>(resolve=>{readerLocked=resolve;});
    const waiting=new Promise<void>(resolve=>{writerWaiting=resolve;});
    const wrapped=(reader:boolean)=>({connect:async()=>{
      const client=await s.pool.connect();let first=true;
      return {release:()=>client.release(),query:async(query:string|QueryConfig,values?:unknown[])=>{
        const text=typeof query==="string"?query:query.text;
        const userLock=text.includes("FROM users")&&text.includes("FOR UPDATE");
        if(!reader&&userLock&&first){first=false;writerWaiting();}
        const result=await client.query(query,values);
        if(reader&&userLock&&first){first=false;readerLocked();await release;}
        return result;
      }};
    }});
    const recovery=readShiftCreationOperation(session,creationId,wrapped(true) as never);
    // Surface failures immediately instead of waiting for an unreachable lock barrier.
    await Promise.race([locked,recovery.then(()=>{throw new Error("Recovery completed before reader lock barrier");})]);
    const replay=executeGateShiftAssignment(session,shift.id,input,wrapped(false) as never);
    let recovered, replayed;
    try {
      await Promise.race([waiting,replay.then(()=>{throw new Error("Assignment completed before writer lock barrier");})]);
      releaseReader();
      [recovered,replayed]=await Promise.all([recovery,replay]);
    } finally {
      releaseReader();
      await Promise.allSettled([recovery,replay]);
    }
    expect(recovered.receipt?.resource.id).toBe(shift.id);expect(replayed).toEqual(first);
    const [otherShift]=await s.db.insert(s.workHubShiftsTable).values({...shift,id:randomUUID(),title:"Synthetic second shift"}).returning();
    // Both transactions target different shifts but share the same worker and conflicting rows.
    const lockBoth=async(id:string)=>{const client=await s.pool.connect();try{await client.query("BEGIN");await lockShiftSchedulingRows(client,admin.id,id,[worker.id]);await client.query("COMMIT");}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}};
    await Promise.all([lockBoth(shift.id),lockBoth(otherShift.id)]);
    const [foreignVendor] = await s.db.insert(s.vendorsTable).values({ name: `Foreign synthetic ${marker}`, contactName: "Synthetic", contactEmail: `f.${marker}@example.invalid` }).returning();
    await expect(executeGateShiftAssignment({ ...session, vendorId: foreignVendor.id }, shift.id, { ...input, operationId: randomUUID(), expectedVersion: 2 })).rejects.toThrow();
    await s.db.update(s.userOrgMembershipsTable).set({ role: "member" }).where(eq(s.userOrgMembershipsTable.id, membership.id));
    await expect(executeGateShiftAssignment(session, shift.id, input)).rejects.toThrow();
    await expect(readGateShiftAssignment(session, shift.id, input.operationId)).rejects.toThrow();
    await s.db.update(s.userOrgMembershipsTable).set({ role: "admin" }).where(eq(s.userOrgMembershipsTable.id, membership.id));
    await s.db.update(s.partnerVendorRelationshipsTable).set({ status: "auto_unapproved" }).where(eq(s.partnerVendorRelationshipsTable.id, relationship.id));
    await expect(executeGateShiftAssignment(session, shift.id, input)).rejects.toThrow("contract_required");
    await expect(readGateShiftAssignment(session, shift.id, input.operationId)).rejects.toThrow("contract_required");
    expect((await s.db.select().from(s.workHubShiftsTable).where(eq(s.workHubShiftsTable.id, shift.id)))[0].version).toBe(2);
  });
});
