import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { buildTestCookie } from "../test-utils/session";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
const isolated =
  process.env.VNDRLY_TEST_DB_MODE === "fresh-local" &&
  process.env.VNDRLY_ISOLATED_TEST_DB === "1";
describe.skipIf(!isolated)("Fleet billing PostgreSQL transaction", () => {
  it("creates ticket/run atomically, preserves routes, serializes exact retries and explicitly finalizes reviewed shared runs", async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const s = await import("@workspace/db"),
      { createFleetService } = await import("./fleet-ops"),
      { databaseFleetRepository } = await import("./fleet-repository");
    const tag = randomUUID();
    const [vendor] = await s.db
      .insert(s.vendorsTable)
      .values({
        name: `Synthetic billing ${tag}`,
        contactName: "Synthetic",
        contactEmail: `${tag}@example.invalid`,
      })
      .returning();
    const [partner] = await s.db
      .insert(s.partnersTable)
      .values({
        name: `Synthetic billing ${tag}`,
        contactName: "Synthetic",
        contactEmail: `p.${tag}@example.invalid`,
      })
      .returning();
    const [site] = await s.db
      .insert(s.siteLocationsTable)
      .values({
        partnerId: partner.id,
        name: "Synthetic origin",
        address: "Isolated test",
        latitude: 30,
        longitude: -100,
        siteCode: tag,
        afe: "A1",
      })
      .returning();
    const [workType] = await s.db
      .insert(s.workTypesTable)
      .values({ name: `Synthetic haul ${tag}`, category: "hauling" })
      .returning();
    await s.db.insert(s.vendorWorkTypesTable).values({
      vendorId: vendor.id,
      workTypeId: workType.id,
      unit: "per_hour",
      unitPrice: "12.34",
      currency: "USD",
    });
    await s.db.insert(s.siteWorkAssignmentsTable).values({
      vendorId: vendor.id,
      workTypeId: workType.id,
      siteLocationId: site.id,
      afe: "A1",
    });
    await s.db.insert(s.partnerVendorRelationshipsTable).values({
      partnerId: partner.id,
      vendorId: vendor.id,
      status: "approved",
    });
    await s.db.insert(s.partnerVendorWorkTypeApprovalsTable).values({partnerId:partner.id,vendorId:vendor.id,workTypeId:workType.id});
    const [manager, driver] = await s.db
      .insert(s.usersTable)
      .values([
        {
          username: `bm-${tag}`,
          passwordHash: "synthetic-unusable",
          role: "vendor",
          displayName: "Synthetic manager",
        },
        {
          username: `bd-${tag}`,
          passwordHash: "synthetic-unusable",
          role: "field_employee",
          displayName: "Synthetic driver",
        },
      ])
      .returning();
    const [person] = await s.db
      .insert(s.vendorPeopleTable)
      .values({
        vendorId: vendor.id,
        userId: driver.id,
        firstName: "Synthetic driver",
        email: `d.${tag}@example.invalid`,
      })
      .returning();
    await s.db.insert(s.userOrgMembershipsTable).values({
      userId: driver.id,
      orgType: "vendor",
      vendorId: vendor.id,
      vendorPeopleId: person.id,
      role: "field_employee",
    });
    await s.db
      .insert(s.vendorPersonSiteAccessTable)
      .values({ vendorPeopleId: person.id, siteLocationId: site.id });
    const [membership] = await s.db
      .insert(s.userOrgMembershipsTable)
      .values({
        userId: manager.id,
        orgType: "vendor",
        vendorId: vendor.id,
        role: "admin",
      })
      .returning();
    const [vehicle] = await s.db
      .insert(s.assetsTable)
      .values({
        name: "Synthetic truck",
        category: "truck",
        legalOwnerName: "Synthetic",
        responsibleOrgType: "vendor",
        responsibleOrgId: vendor.id,
      })
      .returning();
    await s.pool.query(
      "INSERT INTO asset_attachment_links(asset_id,attachment_type,attachment_id,linked_by_user_id) VALUES($1,'fleet_inventory',$2,$3)",
      [vehicle.id, String(vendor.id), manager.id],
    );
    const actor = () => ({
      userId: manager.id,
      companyId: vendor.id,
      role: "vendor",
      membershipRole: "admin",
      activeMembershipId: membership.id,
      sv: manager.sessionVersion,
    });
    const service = createFleetService(databaseFleetRepository),
      fleetId = randomUUID();
    await service.setup(actor(), {
      expectedVersion: 1,
      enabled: true,
      fleets: [
        {
          id: fleetId,
          name: "Synthetic fleet",
          siteIds: [site.id],
          equipmentAssetIds: [vehicle.id],
          requiredCertifications: [],
        },
      ],
      grants: [
        {
          userId: manager.id,
          fleetIds: [fleetId],
          siteIds: [site.id],
          roles: ["fleet_manager", "dispatcher"],
          financeRead: true,
          safetyRelease: false,
        },
        {
          userId: driver.id,
          fleetIds: [fleetId],
          siteIds: [site.id],
          roles: ["driver"],
          financeRead: false,
          safetyRelease: false,
        },
      ],
    });
    const body = {
      operationId: randomUUID(),
      fleetId,
      title: "Synthetic shared haul",
      driverUserId: driver.id,
      vehicleAssetId: vehicle.id,
      billing: {
        mode: "new_ticket",
        workTypeId: workType.id,
        afeNumber: "A1",
        workDate: "2026-10-16",
      },
      stops: ["pickup", "delivery", "pickup", "delivery"].map(
        (kind, sequence) => ({
          id: randomUUID(),
          siteId: site.id,
          kind,
          sequence,
        }),
      ),
    };
    const [run, retry] = await Promise.all([
      service.create(actor(), body),
      service.create(actor(), body),
    ]);
    expect(retry.id).toBe(run.id);
    expect(run.stops).toEqual(body.stops);
    expect(run.linkedTicketId).toBeTypeOf("number");
    expect(
      (
        await s.pool.query(
          "SELECT count(*)::int AS count FROM tickets WHERE vendor_id=$1",
          [vendor.id],
        )
      ).rows[0].count,
    ).toBe(1);
    await expect(
      service.create(actor(), { ...body, title: "Changed retry" }),
    ).rejects.toMatchObject({ code: "fleet.operation_conflict" });
    await expect(
      service.create(actor(), {
        ...body,
        operationId: randomUUID(),
        vehicleAssetId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "fleet.equipment_grant_required" });
    expect(
      (
        await s.pool.query(
          "SELECT count(*)::int AS count FROM tickets WHERE vendor_id=$1",
          [vendor.id],
        )
      ).rows[0].count,
    ).toBe(1);
    const linked = await service.create(actor(), {
      ...body,
      operationId: randomUUID(),
      billing: {
        mode: "existing_ticket",
        ticketId: run.linkedTicketId!,
        afeNumber: "A1",
        workDate: "2026-10-16",
      },
    });
    const { default: ticketRoutes } = await import("../routes/tickets");
    const app = express()
      .use(express.json())
      .use(cookieParser())
      .use(ticketRoutes);
    const cookie = buildTestCookie({
      ...actor(),
      vendorId: vendor.id,
      partnerId: null,
    });
    const ordinarySubmit = await request(app)
      .post(`/tickets/${run.linkedTicketId}/submit`)
      .set("Cookie", cookie)
      .send({});
    expect(ordinarySubmit.status).toBe(409);
    expect(ordinarySubmit.body.code).toBe("fleet.office_finalize_required");
    const finalize = { operationId: randomUUID(), expectedVersion: 1 };
    await expect(
      service.finalizeTicket(actor(), run.linkedTicketId!, finalize),
    ).rejects.toMatchObject({ code: "fleet.runs_not_reviewed" });
    // Synthetic immutable snapshots stage the office review boundary; ordinary driver flows are covered separately.
    for (const entry of [run, linked]) {
      const { recordFleetBillingCharge } = await import("./fleet-billing");
      const client = await s.pool.connect();
      try {
        await client.query("BEGIN");
        await expect(
          recordFleetBillingCharge(client, actor(), entry),
        ).rejects.toMatchObject({ code: "fleet.billing_quantity_required" });
        await recordFleetBillingCharge(client, actor(), entry, 2.5);
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      entry.status = "completed";
      expect(entry.billing?.quantity).toBe(2.5);
      entry.version++;
      await s.pool.query(
        "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_run','fleet-run-snapshot','fleet-run',$3,$4::jsonb,'completed')",
        [manager.id, vendor.id, entry.id, JSON.stringify(entry)],
      );
    }
    await s.pool.query(
      "UPDATE vendors SET fleet_ops_state=jsonb_set(fleet_ops_state,'{runs}','[]'::jsonb) WHERE id=$1",
      [vendor.id],
    );
    const protectedDelete = await request(app)
      .delete(
        `/tickets/${run.linkedTicketId}/line-items/${run.billing!.billedLineId}`,
      )
      .set("Cookie", cookie);
    expect(protectedDelete.status).toBe(409);
    expect(protectedDelete.body.code).toBe("fleet.derived_charge_locked");
    const extra = (
      await s.pool.query(
        "INSERT INTO ticket_line_items(ticket_id,type,description,quantity,unit_price) VALUES($1,'other','Synthetic manual extra',1,1) RETURNING id",
        [run.linkedTicketId],
      )
    ).rows[0];
    expect(
      (
        await request(app)
          .delete(`/tickets/${run.linkedTicketId}/line-items/${extra.id}`)
          .set("Cookie", cookie)
      ).status,
    ).toBe(200);
    const ordinary = (
      await s.pool.query(
        "INSERT INTO tickets(site_location_id,vendor_id,work_type_id,status) VALUES($1,$2,$3,'initiated') RETURNING id",
        [site.id, vendor.id, workType.id],
      )
    ).rows[0];
    const legacyLine = (
      await s.pool.query(
        "INSERT INTO ticket_line_items(ticket_id,type,description,quantity,unit_price) VALUES($1,'other',$2,1,1) RETURNING id",
        [ordinary.id, `Fleet run ${run.id}`],
      )
    ).rows[0];
    expect(
      (
        await request(app)
          .delete(`/tickets/${ordinary.id}/line-items/${legacyLine.id}`)
          .set("Cookie", cookie)
      ).status,
    ).toBe(200);
    const ready = await service.ticketPlan(actor(), run.linkedTicketId!);
    expect(ready.canFinalize).toBe(true);
    expect(ready.runs).toHaveLength(2);
    const [result, replayed] = await Promise.all([
      service.finalizeTicket(actor(), run.linkedTicketId!, finalize),
      service.finalizeTicket(actor(), run.linkedTicketId!, finalize),
    ]);
    expect(result).toEqual(replayed);
    expect(result.status).toBe("submitted");
    expect(result.plan.version).toBe(2);
    expect(
      await service.ticketPlan(actor(), run.linkedTicketId!),
    ).toMatchObject({
      status: "submitted",
      canFinalize: false,
      finalizationOperationId: finalize.operationId,
    });
    await s.pool.query("UPDATE tickets SET status='kicked_back' WHERE id=$1", [
      run.linkedTicketId,
    ]);
    expect(
      (await service.ticketPlan(actor(), run.linkedTicketId!)).canFinalize,
    ).toBe(true);
    expect(
      await service.finalizeTicket(actor(), run.linkedTicketId!, {
        operationId: randomUUID(),
        expectedVersion: 2,
      }),
    ).toMatchObject({ status: "submitted", plan: { version: 3 } });
    await s.pool.query(
      "UPDATE site_work_assignments SET afe='A2' WHERE vendor_id=$1 AND site_location_id=$2 AND work_type_id=$3",
      [vendor.id, site.id, workType.id],
    );
    const canonical = await request(app)
      .get(`/tickets/${run.linkedTicketId}`)
      .set("Cookie", cookie);
    expect(canonical.status).toBe(200);
    expect(canonical.body.afe).toBe("A1");
    await expect(
      service.create(actor(), {
        ...body,
        operationId: randomUUID(),
        billing: {
          mode: "existing_ticket",
          ticketId: run.linkedTicketId!,
          afeNumber: "A1",
          workDate: "2026-10-16",
        },
      }),
    ).rejects.toMatchObject({ code: "fleet.ticket_closed" });
  }, 45000);
});
