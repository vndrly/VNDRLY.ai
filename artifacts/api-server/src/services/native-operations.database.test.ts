import { randomUUID, createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
const isolated =
  process.env.VNDRLY_TEST_DB_MODE === "fresh-local" &&
  process.env.VNDRLY_ISOLATED_TEST_DB === "1";
if (isolated) assertFreshLocalTestDatabaseEnvironment(process.env);
vi.mock("../routes/notifications", () => ({ fanOutPushToUser: vi.fn() }));
const photos = vi.hoisted(
  () =>
    new Map<
      string,
      { contentType: string; size: number; acl: any; body: Buffer }
    >(),
);
vi.mock("../lib/objectStore", () => ({
  getObjectStore: () => ({
    getObject: async (path: string) => photos.get(path) ?? null,
  }),
}));
describe.skipIf(!isolated)(
  "native operations isolated PostgreSQL authority",
  () => {
    it("serializes request throttle/idempotency and rejects stale phone, consent, membership and scoped grant changes", async () => {
      assertFreshLocalTestDatabaseEnvironment(process.env);
      const s = await import("@workspace/db"),
        { eq } = await import("drizzle-orm"),
        { nativeOperationsService: api } = await import("./native-operations");
      const target = new URL(process.env.DATABASE_URL!);
      expect(
        (
          await s.pool.query(
            "SELECT current_database() AS database,host(inet_server_addr()) AS address,inet_server_port() AS port",
          )
        ).rows[0],
      ).toEqual({
        database: process.env.VNDRLY_FRESH_TEST_DB_NAME,
        address: "127.0.0.1",
        port: Number(target.port),
      });
      const marker = randomUUID();
      const [vendor] = await s.db
        .insert(s.vendorsTable)
        .values({
          name: `Synthetic Native ${marker}`,
          contactName: "Synthetic",
          contactEmail: `${marker}@example.invalid`,
        })
        .returning();
      const [partner] = await s.db
        .insert(s.partnersTable)
        .values({
          name: `Native Partner ${marker}`,
          contactName: "Synthetic",
          contactEmail: `p.${marker}@example.invalid`,
        })
        .returning();
      const [site] = await s.db
        .insert(s.siteLocationsTable)
        .values({
          partnerId: partner.id,
          name: "Synthetic Native Site",
          address: "Isolated",
          siteCode: `N-${marker}`,
          latitude: 30,
          longitude: -100,
        })
        .returning();
      const [type] = await s.db
        .insert(s.workTypesTable)
        .values({ name: `Native ${marker}`, category: "field" })
        .returning();
      const [manager, worker, external] = await s.db
        .insert(s.usersTable)
        .values([
          {
            username: `nm-${marker}`,
            passwordHash: "unusable-synthetic",
            role: "vendor",
            displayName: "Native supervisor",
          },
          {
            username: `nw-${marker}`,
            passwordHash: "unusable-synthetic",
            role: "field_employee",
            displayName: "Native worker",
          },
          {
            username: `np-${marker}`,
            passwordHash: "unusable-synthetic",
            role: "partner",
            displayName: "Native partner supervisor",
          },
        ])
        .returning();
      const [person] = await s.db
        .insert(s.vendorPeopleTable)
        .values({
          vendorId: vendor.id,
          userId: worker.id,
          firstName: "Synthetic",
          lastName: "Native",
          email: `w-${marker}@example.invalid`,
        })
        .returning();
      const memberships = await s.db
        .insert(s.userOrgMembershipsTable)
        .values([
          {
            userId: manager.id,
            orgType: "vendor",
            vendorId: vendor.id,
            role: "admin",
          },
          {
            userId: worker.id,
            orgType: "vendor",
            vendorId: vendor.id,
            role: "field_employee",
            vendorPeopleId: person.id,
          },
          {
            userId: external.id,
            orgType: "partner",
            partnerId: partner.id,
            role: "admin",
          },
        ])
        .returning();
      const [ticket] = await s.db
        .insert(s.ticketsTable)
        .values({
          siteLocationId: site.id,
          vendorId: vendor.id,
          fieldEmployeeId: person.id,
          workTypeId: type.id,
          status: "in_progress",
          lifecycleState: "on_site",
        })
        .returning();
      const managerSession = {
          userId: manager.id,
          sv: manager.sessionVersion,
          vendorId: vendor.id,
          role: "vendor",
          membershipRole: "admin",
        },
        workerSession = {
          userId: worker.id,
          sv: worker.sessionVersion,
          vendorId: vendor.id,
          role: "field_employee",
        },
        partnerSession = {
          userId: external.id,
          sv: external.sessionVersion,
          partnerId: partner.id,
          role: "partner",
        };
      const [oldPhone, newPhone] = await s.db
        .insert(s.workHubDevicesTable)
        .values([
          {
            userId: worker.id,
            ownerOrgType: "vendor",
            ownerOrgId: vendor.id,
            friendlyName: "Old synthetic phone",
            deviceClass: "phone",
          },
          {
            userId: worker.id,
            ownerOrgType: "vendor",
            ownerOrgId: vendor.id,
            friendlyName: "New synthetic phone",
            deviceClass: "phone",
          },
        ])
        .returning();
      await s.db.insert(s.workHubDeviceConnectionsTable).values({
        deviceId: oldPhone.id,
        connectionId: randomUUID(),
        foreground: true,
        seenAt: new Date(),
      });
      await api.device(workerSession, oldPhone.id);
      await api.consent(workerSession, true);
      await api.duty(workerSession, {
        action: "start",
        mode: "ticket",
        ticketId: ticket.id,
      });
      // Exercise the real authority transaction and canonical mutation callback.
      const { authorizeNativeAutomaticArrival: arrival } =
        await import("./native-operations");
      const binding = { deviceId: oldPhone.id, bindingVersion: 1 };
      const apply = async (client: import("pg").PoolClient) => {
        await client.query(
          "UPDATE tickets SET on_location_latitude=31 WHERE id=$1",
          [ticket.id],
        );
        return { applied: true };
      };
      const latitude = async () =>
        (
          await s.pool.query(
            "SELECT on_location_latitude FROM tickets WHERE id=$1",
            [ticket.id],
          )
        ).rows[0].on_location_latitude;
      await expect(
        arrival(workerSession, ticket.id, binding, apply),
      ).rejects.toThrow("native.automatic_arrival_opt_in_required");
      expect(await latitude()).toBeNull();
      await api.policy(managerSession, { automaticArrival: true });
      await expect(
        arrival(workerSession, ticket.id, binding, apply),
      ).rejects.toThrow("native.automatic_arrival_opt_in_required");
      await api.consent(workerSession, {
        locationSharing: true,
        automaticArrival: true,
      });
      await expect(
        arrival(
          workerSession,
          ticket.id,
          { ...binding, deviceId: newPhone.id },
          apply,
        ),
      ).rejects.toThrow("native.work_phone_changed");
      await s.pool.query(
        "UPDATE tickets SET field_employee_id=NULL WHERE id=$1",
        [ticket.id],
      );
      await expect(
        arrival(workerSession, ticket.id, binding, apply),
      ).rejects.toThrow("native.ticket_scope_required");
      await s.pool.query(
        "UPDATE tickets SET field_employee_id=$2 WHERE id=$1",
        [ticket.id, person.id],
      );
      await api.duty(workerSession, { action: "end", mode: "ticket" });
      await expect(
        arrival(workerSession, ticket.id, binding, apply),
      ).rejects.toThrow("native.duty_ended");
      await api.duty(workerSession, {
        action: "start",
        mode: "ticket",
        ticketId: ticket.id,
      });
      await expect(
        arrival(workerSession, ticket.id, binding, async (client) => {
          await apply(client);
          throw new Error("synthetic callback failure");
        }),
      ).rejects.toThrow("synthetic callback failure");
      expect(await latitude()).toBeNull();
      expect(await arrival(workerSession, ticket.id, binding, apply)).toEqual({
        applied: true,
      });
      expect(Number(await latitude())).toBe(31);
      await s.pool.query(
        "UPDATE tickets SET on_location_latitude=NULL WHERE id=$1",
        [ticket.id],
      );
      await api.policy(managerSession, { automaticArrival: false });
      await expect(
        arrival(workerSession, ticket.id, binding, apply),
      ).rejects.toThrow("native.automatic_arrival_opt_in_required");
      expect(await latitude()).toBeNull();
      const [shift] = await s.db
        .insert(s.workHubShiftsTable)
        .values({
          ownerOrgType: "vendor",
          ownerOrgId: vendor.id,
          title: "Synthetic response",
          startsAt: new Date(),
          endsAt: new Date(Date.now() + 3600_000),
          timezone: "UTC",
          createdById: manager.id,
        })
        .returning();
      const [shiftAssignment] = await s.db
        .insert(s.workHubShiftAssignmentsTable)
        .values({
          shiftId: shift.id,
          userId: worker.id,
          status: "assigned",
          assignedById: manager.id,
        })
        .returning();
      const ownResponse = { operationId: randomUUID(), response: "accepted" };
      const accepted = await api.shiftResponse(
        workerSession,
        shift.id,
        ownResponse,
      );
      expect(accepted).toMatchObject({
        assignmentId: shiftAssignment.id,
        status: "accepted",
      });
      expect(
        await api.shiftResponse(workerSession, shift.id, ownResponse),
      ).toEqual(accepted);
      expect(
        (
          await s.pool.query(
            "SELECT status FROM work_hub_shift_assignments WHERE id=$1",
            [shiftAssignment.id],
          )
        ).rows[0].status,
      ).toBe("accepted");
      await expect(
        api.shiftResponse(workerSession, shift.id, {
          ...ownResponse,
          response: "declined",
          reason: "Changed",
        }),
      ).rejects.toThrow("native.idempotency_conflict");
      await expect(
        api.shiftResponse(managerSession, shift.id, {
          operationId: randomUUID(),
          response: "accepted",
        }),
      ).rejects.toThrow("native.shift_no_access");
      await s.pool.query(
        "UPDATE work_hub_shift_assignments SET status='removed' WHERE id=$1",
        [shiftAssignment.id],
      );
      await expect(
        api.shiftResponse(workerSession, shift.id, {
          operationId: randomUUID(),
          response: "accepted",
        }),
      ).rejects.toThrow("native.shift_not_respondable");
      const command = {
        workerUserId: worker.id,
        vendorId: vendor.id,
        siteId: site.id,
        ticketId: ticket.id,
        kind: "location" as const,
        purpose: "Synthetic supervisor arrival",
        idempotencyKey: randomUUID(),
      };
      await expect(api.request(partnerSession, command)).rejects.toThrow(
        "native.no_access",
      );
      await api.policy(managerSession, {
        grants: [
          {
            requesterUserId: external.id,
            workerUserId: worker.id,
            siteId: site.id,
            ticketId: ticket.id,
          },
        ],
      });
      const [first, retry] = await Promise.all([
        api.request(managerSession, command),
        api.request(managerSession, command),
      ]);
      expect(first.id).toBe(retry.id);
      expect(first.state).toBe("pending");
      const throttled = await api.request(partnerSession, {
        ...command,
        idempotencyKey: randomUUID(),
      });
      expect(throttled).toMatchObject({ id: first.id, throttled: true });
      await expect(
        api.request(managerSession, { ...command, purpose: "changed" }),
      ).rejects.toThrow("native.idempotency_conflict");
      await api.device(workerSession, newPhone.id);
      await expect(
        api.respond(workerSession, first.id, {
          deviceId: oldPhone.id,
          bindingVersion: 1,
          state: "saved",
          location: {
            latitude: 30,
            longitude: -100,
            accuracy: 10,
            capturedAt: new Date().toISOString(),
          },
        }),
      ).rejects.toThrow("native.work_phone_changed");
      const moved = await api.read(workerSession, first.id);
      expect(moved.deviceId).toBe(newPhone.id);
      expect(moved.bindingVersion).toBe(2);
      await api.consent(workerSession, false);
      await expect(
        api.respond(workerSession, first.id, {
          deviceId: newPhone.id,
          bindingVersion: 2,
          state: "saved",
          location: {
            latitude: 30,
            longitude: -100,
            accuracy: 10,
            capturedAt: new Date().toISOString(),
          },
        }),
      ).rejects.toThrow("native.location_sharing_unavailable");
      await api.consent(workerSession, true);
      const saved = await api.respond(workerSession, first.id, {
        deviceId: newPhone.id,
        bindingVersion: 2,
        state: "saved",
        location: {
          latitude: 30,
          longitude: -100,
          accuracy: 10,
          capturedAt: new Date().toISOString(),
        },
      });
      expect(saved.state).toBe("saved");
      expect((await api.read(managerSession, first.id)).result).toMatchObject({
        location: { accuracy: 10 },
      });
      await api.duty(workerSession, { action: "end", mode: "manual" });
      expect((await api.status(workerSession)).duty.active).toBe(false);
      await s.db
        .update(s.userOrgMembershipsTable)
        .set({ role: "member" })
        .where(eq(s.userOrgMembershipsTable.id, memberships[0].id));
      await expect(api.read(managerSession, first.id)).rejects.toThrow(
        "native.no_access",
      );
      const retention = await s.pool.query(
        "SELECT min(retention_until-created_at) AS retained FROM work_hub_user_events WHERE owner_org_type='vendor' AND owner_org_id=$1 AND event_type='native.operation'",
        [vendor.id],
      );
      expect(retention.rows[0].retained.days).toBe(365);
    });
    it("requires immutable exact ticket photo association and saves late old-phone upload evidence distinctly", async () => {
      assertFreshLocalTestDatabaseEnvironment(process.env);
      const s = await import("@workspace/db"),
        { nativeOperationsService: api } = await import("./native-operations");
      const marker = randomUUID(),
        [vendor] = await s.db
          .insert(s.vendorsTable)
          .values({
            name: `Photo Native ${marker}`,
            contactName: "Synthetic",
            contactEmail: `${marker}@example.invalid`,
          })
          .returning();
      const [partner] = await s.db
        .insert(s.partnersTable)
        .values({
          name: `Photo Partner ${marker}`,
          contactName: "Synthetic",
          contactEmail: `p.${marker}@example.invalid`,
        })
        .returning();
      const [site] = await s.db
        .insert(s.siteLocationsTable)
        .values({
          partnerId: partner.id,
          name: "Photo isolated",
          address: "Isolated",
          siteCode: `P-${marker}`,
          latitude: 30,
          longitude: -100,
        })
        .returning();
      const [type] = await s.db
        .insert(s.workTypesTable)
        .values({ name: `Photo ${marker}`, category: "field" })
        .returning();
      const [manager, worker] = await s.db
        .insert(s.usersTable)
        .values([
          {
            username: `pm-${marker}`,
            passwordHash: "unusable-synthetic",
            role: "vendor",
            displayName: "Photo manager",
          },
          {
            username: `pw-${marker}`,
            passwordHash: "unusable-synthetic",
            role: "field_employee",
            displayName: "Photo worker",
          },
        ])
        .returning();
      const [person] = await s.db
        .insert(s.vendorPeopleTable)
        .values({
          vendorId: vendor.id,
          userId: worker.id,
          firstName: "Synthetic",
          email: `pw-${marker}@example.invalid`,
        })
        .returning();
      await s.db.insert(s.userOrgMembershipsTable).values([
        {
          userId: manager.id,
          orgType: "vendor",
          vendorId: vendor.id,
          role: "admin",
        },
        {
          userId: worker.id,
          orgType: "vendor",
          vendorId: vendor.id,
          role: "field_employee",
          vendorPeopleId: person.id,
        },
      ]);
      const [ticket] = await s.db
        .insert(s.ticketsTable)
        .values({
          siteLocationId: site.id,
          vendorId: vendor.id,
          fieldEmployeeId: person.id,
          workTypeId: type.id,
        })
        .returning();
      const ms = {
          userId: manager.id,
          sv: manager.sessionVersion,
          vendorId: vendor.id,
          role: "vendor",
        },
        ws = {
          userId: worker.id,
          sv: worker.sessionVersion,
          vendorId: vendor.id,
          role: "field_employee",
        };
      const [phone] = await s.db
        .insert(s.workHubDevicesTable)
        .values({
          userId: worker.id,
          ownerOrgType: "vendor",
          ownerOrgId: vendor.id,
          friendlyName: "Photo phone",
          deviceClass: "phone",
        })
        .returning();
      await api.device(ws, phone.id);
      const r = await api.request(ms, {
        workerUserId: worker.id,
        vendorId: vendor.id,
        ticketId: ticket.id,
        kind: "photo",
        purpose: "Synthetic photo",
        idempotencyKey: randomUUID(),
      });
      await api.respond(ws, r.id, {
        deviceId: phone.id,
        bindingVersion: 1,
        state: "opened",
      });
      await api.respond(ws, r.id, {
        deviceId: phone.id,
        bindingVersion: 1,
        state: "upload-in-progress",
      });
      const operationId = randomUUID(),
        path = "/objects/uploads/" + operationId;
      const [note] = await s.db
        .insert(s.ticketNoteLogsTable)
        .values({
          ticketId: ticket.id,
          createdById: worker.id,
          content: "[photo] " + path,
        })
        .returning();
      const response = {
        deviceId: phone.id,
        bindingVersion: 1,
        state: "saved",
        noteId: note.id,
        operationId,
        objectPath: path,
        photoSource: "camera" as const,
      };
      await expect(api.respond(ws, r.id, response)).rejects.toThrow(
        "native.photo_association_not_found",
      );
      const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
      photos.set(path, {
        contentType: "image/png",
        size: bytes.length,
        body: bytes,
        acl: { owner: String(worker.id), visibility: "private" },
      });
      const receipt = {
        ticketId: ticket.id,
        noteId: note.id,
        objectPath: path,
        operationId,
        status: "applied",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.length,
        contentType: "image/png",
      };
      await s.pool.query(
        "INSERT INTO assistant_action_audit(user_id,actor_role,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_input,tool_output,result_status) VALUES($1,'field_employee','api','device_entry','vndrly','associate_ticket_photo','mutation','ticket-photo-association',$2,'{}'::jsonb,$3::jsonb,'success')",
        [worker.id, operationId, JSON.stringify(receipt)],
      );
      const expired = {
        ...(await api.read(ws, r.id)),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      };
      await s.pool.query(
        "INSERT INTO work_hub_user_events(user_id,owner_org_type,owner_org_id,event_type,payload,retention_until) VALUES($1,'vendor',$2,'native.operation',$3::jsonb,now()+interval '365 days')",
        [worker.id, vendor.id, JSON.stringify({ request: expired })],
      );
      const saved = await api.respond(ws, r.id, response);
      expect(saved.state).toBe("saved");
      expect(saved.result).toMatchObject({
        late: true,
        photo: {
          ticketId: ticket.id,
          noteId: note.id,
          physicalCaptureVerified: false,
        },
      });
      expect((await api.read(ms, r.id)).result).toEqual(saved.result);
    });
  },
);
