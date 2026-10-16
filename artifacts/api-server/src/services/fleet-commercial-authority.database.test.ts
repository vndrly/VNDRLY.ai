import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { pool } from "@workspace/db";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import { recomputeApproval } from "../lib/approval-derivation";
import {
  readFleetAuthoritySites,
  resolveFleetCommercialAuthority,
} from "./fleet-commercial-authority";
import { createFleetService } from "./fleet-ops";
import { databaseFleetRepository, emptyFleetState } from "./fleet-repository";
import { createFleetSiteActivityService } from "./fleet-site-activity";
import { notifyUsers } from "../routes/notifications";
import type { FleetActor } from "./fleet-ops";
vi.mock("../routes/notifications", () => ({
  notifyUsers: vi.fn(async () => 1),
}));

it("preserves proven approval scope on document lapse, survives renewal, rejects new scopes and explicit revocation", async () => {
  assertFreshLocalTestDatabaseEnvironment(process.env);
  const tag = randomUUID();
  const vendor = (
    await pool.query(
      "INSERT INTO vendors(name,contact_name,contact_email,insurance_expiration_date) VALUES($1,'Synthetic',$2,'2000-01-01') RETURNING id",
      [`Carrier ${tag}`, `${tag}@example.invalid`],
    )
  ).rows[0];
  const partner = (
    await pool.query(
      "INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Synthetic',$2) RETURNING id",
      [`Customer ${tag}`, `${tag}@example.invalid`],
    )
  ).rows[0];
  const user = (
    await pool.query(
      "INSERT INTO users(username,password_hash,role,display_name) VALUES($1,'not-a-login','partner','Synthetic Office') RETURNING id,session_version",
      [`office-${tag}`],
    )
  ).rows[0];
  const partnerMembership = (
    await pool.query(
      "INSERT INTO user_org_memberships(user_id,org_type,partner_id,role) VALUES($1,'partner',$2,'admin') RETURNING id",
      [user.id, partner.id],
    )
  ).rows[0];
  await pool.query(
    "INSERT INTO vendor_people(vendor_id,first_name,email,vendor_role) VALUES($1,'Synthetic',$2,'field')",
    [vendor.id, `${tag}@example.invalid`],
  );
  const relationship = (
    await pool.query(
      "INSERT INTO partner_vendor_relationships(partner_id,vendor_id,status,approved_by_user_id,approved_at) VALUES($1,$2,'approved',$3,NOW()) RETURNING id",
      [partner.id, vendor.id, user.id],
    )
  ).rows[0];
  await pool.query(
    "INSERT INTO partner_vendor_approval_events(partner_id,vendor_id,from_status,to_status,reason,actor_user_id) VALUES($1,$2,'pending_review','approved','partner_eula_accepted',$3)",
    [partner.id, vendor.id, user.id],
  );
  const site = (
    await pool.query(
      "INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) VALUES($1,'Billing pad','Synthetic',35,-97,$2) RETURNING id",
      [partner.id, tag],
    )
  ).rows[0];
  const work = (
    await pool.query(
      "INSERT INTO work_types(name,category) VALUES($1,'haul') RETURNING id",
      [`Haul ${tag}`],
    )
  ).rows[0];
  await pool.query(
    "INSERT INTO vendor_work_types(vendor_id,work_type_id,unit_price,unit) VALUES($1,$2,'1.00','per_job')",
    [vendor.id, work.id],
  );
  await pool.query(
    "INSERT INTO site_work_assignments(vendor_id,site_location_id,work_type_id) VALUES($1,$2,$3)",
    [vendor.id, site.id, work.id],
  );
  await pool.query(
    "INSERT INTO partner_vendor_work_type_approvals(partner_id,vendor_id,work_type_id,approved_by_user_id) VALUES($1,$2,$3,$4)",
    [partner.id, vendor.id, work.id, user.id],
  );
  const changed = await recomputeApproval(partner.id, vendor.id, {
    triggerReason: "vendor_compliance_updated",
  });
  expect(changed).toMatchObject({ toStatus: "auto_unapproved" });
  const row = (
    await pool.query(
      "SELECT fleet_commercial_authority FROM partner_vendor_relationships WHERE id=$1",
      [relationship.id],
    )
  ).rows[0];
  expect(row.fleet_commercial_authority).toMatchObject({
    version: 1,
    scopes: [{ siteId: site.id, workTypeId: work.id }],
  });
  const client = await pool.connect();
  try {
    const input = {
      partnerId: partner.id,
      billingSiteId: site.id,
      workTypeId: work.id,
      workDate: "2026-10-16",
      purpose: "execute" as const,
      policyAt: new Date().toISOString(),
    };
    const authority = await resolveFleetCommercialAuthority(
      client,
      { companyId: vendor.id },
      input,
    );
    expect(authority).toMatchObject({
      allowed: true,
      basis: "prior_approval_compliance_warning",
      warnings: ["coi_expired"],
    });
    if (!authority.allowed) throw new Error("Expected scoped authority");
    const proof = (
      await pool.query(
        "SELECT tool_output FROM assistant_action_audit WHERE target_type='fleet-commercial-authority' AND target_id=$1 AND vendor_id=$2",
        [authority.approvalSnapshotId, vendor.id],
      )
    ).rows[0];
    expect(proof?.tool_output).toMatchObject({
      companyId: vendor.id,
      partnerId: partner.id,
      billingSiteId: site.id,
      workTypeId: work.id,
      basis: "prior_approval_compliance_warning",
    });
    expect(
      (await readFleetAuthoritySites(client, vendor.id)).map((row) => row.id),
    ).toEqual([site.id]);
    const staff: FleetActor[] = [];
    for (const role of ["admin", "field_employee"]) {
      const person = (
        await pool.query(
          "INSERT INTO users(username,password_hash,role,display_name) VALUES($1,'not-a-login',$2,$3) RETURNING id,session_version",
          [
            `${role}-${tag}`,
            role === "admin" ? "vendor" : "field_employee",
            role,
          ],
        )
      ).rows[0];
      const membership = (
        await pool.query(
          "INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role) VALUES($1,'vendor',$2,$3) RETURNING id",
          [person.id, vendor.id, role],
        )
      ).rows[0];
      const vp = (
        await pool.query(
          "INSERT INTO vendor_people(user_id,vendor_id,first_name,email,vendor_role) VALUES($1,$2,'Synthetic',$3,'field') RETURNING id",
          [person.id, vendor.id, `${role}-${tag}@example.invalid`],
        )
      ).rows[0];
      staff.push({
        userId: person.id,
        companyId: vendor.id,
        sv: person.session_version,
        activeMembershipId: membership.id,
        membershipRole: role,
        role: role === "admin" ? "vendor" : "field_employee",
        vendorPeopleId: vp.id,
      });
    }
    const truck = (
      await pool.query(
        "INSERT INTO assets(name,category,legal_owner_name,responsible_org_type,responsible_org_id) VALUES('Synthetic truck','truck','Synthetic','vendor',$1) RETURNING id",
        [vendor.id],
      )
    ).rows[0];
    const groupId = randomUUID();
    await pool.query(
      "UPDATE vendors SET fleet_ops_state=$2::jsonb WHERE id=$1",
      [
        vendor.id,
        JSON.stringify({
          ...emptyFleetState(),
          enabled: true,
          fleets: [
            {
              id: groupId,
              name: "Scoped access",
              siteIds: [site.id],
              equipmentAssetIds: [truck.id],
              requiredCertifications: ["Synthetic DOT credential"],
            },
          ],
          grants: staff.map((person, index) => ({
            userId: person.userId,
            fleetIds: [groupId],
            siteIds: [site.id],
            roles: index ? ["driver"] : ["fleet_manager"],
            financeRead: !index,
            safetyRelease: false,
          })),
        }),
      ],
    );
    const service = createFleetService(databaseFleetRepository);
    const create = {
      operationId: randomUUID(),
      fleetId: groupId,
      title: "Synthetic water haul",
      driverUserId: staff[1].userId,
      vehicleAssetId: truck.id,
      billing: {
        mode: "new_ticket",
        workTypeId: work.id,
        afeNumber: "",
        workDate: "2026-10-16",
      },
      stops: [
        { id: randomUUID(), kind: "pickup", siteId: site.id, sequence: 0 },
        { id: randomUUID(), kind: "delivery", siteId: site.id, sequence: 1 },
      ],
    };
    const unapprovedWork = (
      await pool.query(
        "INSERT INTO work_types(name,category) VALUES($1,'haul') RETURNING id",
        [`Unapproved ${tag}`],
      )
    ).rows[0];
    await pool.query(
      "INSERT INTO vendor_work_types(vendor_id,work_type_id,unit_price,unit) VALUES($1,$2,'1.00','per_job')",
      [vendor.id, unapprovedWork.id],
    );
    await pool.query(
      "INSERT INTO site_work_assignments(vendor_id,site_location_id,work_type_id) VALUES($1,$2,$3)",
      [vendor.id, site.id, unapprovedWork.id],
    );
    await expect(
      service.create(staff[0], {
        ...create,
        operationId: randomUUID(),
        billing: { ...create.billing, workTypeId: unapprovedWork.id },
      }),
    ).rejects.toMatchObject({ code: "fleet.site_service_forbidden" });
    expect(
      (
        await service.billingOptions(staff[0], {
          siteId: site.id,
          afeNumber: "",
          workDate: "2026-10-16",
        })
      ).workTypes.map((row) => row.id),
    ).toEqual([work.id]);
    let run = await service.create(staff[0], create);
    expect(run.linkedTicketId).toBeGreaterThan(0);
    expect(
      (await service.overview(staff[1])).runs.map((row) => row.id),
    ).toContain(run.id);
    const perform = async (
      action: string,
      extra: Record<string, unknown> = {},
    ) => {
      run = await service.action(
        ["dispatch", "review"].includes(action) ? staff[0] : staff[1],
        run.id,
        {
          operationId: randomUUID(),
          expectedVersion: run.version,
          action,
          ...extra,
        },
      );
    };
    await perform("dispatch");
    await perform("acknowledge");
    expect(notifyUsers).toHaveBeenCalledWith(
      [staff[1].userId],
      expect.objectContaining({ type: "fleet_run_event" }),
    );
    await perform("inspect", {
      inspectionOutcome: "passed",
      notes: "Actually inspected",
    });
    await perform("record_meter", {
      reading: 100,
      unit: "miles",
      notes: "Actual meter",
    });
    await perform("start");
    await perform("arrive_stop", { stopId: run.stops[0].id });
    const loadId = randomUUID();
    await perform("record_load", {
      loadId,
      commodity: "Water",
      quantity: 1,
      unit: "bbl",
      manifestReference: "Synthetic receipt",
    });
    await perform("depart_stop", { stopId: run.stops[0].id });
    await perform("arrive_stop", { stopId: run.stops[1].id });
    await perform("record_delivery", {
      loadId,
      deliveryReference: "Synthetic delivery receipt",
    });
    await perform("depart_stop", { stopId: run.stops[1].id });
    await perform("record_meter", {
      reading: 110,
      unit: "miles",
      notes: "Actual end meter",
    });
    await perform("submit_closeout");
    expect(run.status).toBe("submitted_for_review");
    expect(run.events.at(-1)?.details?.fleetCompliance).toMatchObject({
      status: "red",
    });
    await perform("review", {
      decision: "accept",
      reason: "Office reviewed actual delivery and noted compliance exceptions",
    });
    const ticket = (
      await pool.query("SELECT fleet_plan FROM tickets WHERE id=$1", [
        run.linkedTicketId,
      ])
    ).rows[0];
    expect(
      await service.finalizeTicket(staff[0], run.linkedTicketId!, {
        operationId: randomUUID(),
        expectedVersion: ticket.fleet_plan.version,
      }),
    ).toMatchObject({ status: "submitted" });
    expect(
      (
        await pool.query(
          "SELECT tool_output FROM assistant_action_audit WHERE target_type='fleet-ticket-compliance' AND target_id=$1 AND vendor_id=$2",
          [String(run.linkedTicketId), vendor.id],
        )
      ).rows[0].tool_output.checkpoints[0].compliance.status,
    ).toBe("red");
    const partnerService = createFleetSiteActivityService(pool);
    const partnerActor = {
      userId: user.id,
      partnerId: partner.id,
      sv: user.session_version,
      activeMembershipId: partnerMembership.id,
      membershipRole: "admin",
      role: "partner" as const,
    };
    expect(
      (await partnerService.sites(partnerActor)).sites.map((row) => row.siteId),
    ).toContain(site.id);
    const activity = await partnerService.activity(partnerActor, site.id, {});
    expect(
      activity.records[0].complianceCheckpoints?.some(
        (item) => item.status === "red",
      ),
    ).toBe(true);
    expect(JSON.stringify(activity)).not.toContain("Synthetic DOT credential");
    await pool.query(
      "UPDATE vendors SET insurance_expiration_date='2099-01-01' WHERE id=$1",
      [vendor.id],
    );
    await recomputeApproval(partner.id, vendor.id, {
      triggerReason: "vendor_compliance_updated",
    });
    expect(
      await resolveFleetCommercialAuthority(
        client,
        { companyId: vendor.id },
        input,
      ),
    ).toMatchObject({ allowed: true, warnings: ["coi_expired"] });
    expect(authority).toMatchObject({ warnings: ["coi_expired"] });
    const extra = (
      await pool.query(
        "INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) VALUES($1,'New pad','Synthetic',35,-97,$2) RETURNING id",
        [partner.id, randomUUID()],
      )
    ).rows[0];
    await pool.query(
      "INSERT INTO site_work_assignments(vendor_id,site_location_id,work_type_id) VALUES($1,$2,$3)",
      [vendor.id, extra.id, work.id],
    );
    expect(
      await resolveFleetCommercialAuthority(
        client,
        { companyId: vendor.id },
        { ...input, billingSiteId: extra.id },
      ),
    ).toMatchObject({ allowed: false });
    expect(
      (await readFleetAuthoritySites(client, vendor.id)).map((row) => row.id),
    ).toEqual([site.id]);
    await pool.query(
      "UPDATE partner_vendor_relationships SET status='revoked' WHERE id=$1",
      [relationship.id],
    );
    await pool.query(
      "INSERT INTO partner_vendor_approval_events(partner_id,vendor_id,from_status,to_status,reason,actor_user_id) VALUES($1,$2,'auto_unapproved','revoked','manual_revoke',$3)",
      [partner.id, vendor.id, user.id],
    );
    expect(
      await resolveFleetCommercialAuthority(
        client,
        { companyId: vendor.id },
        input,
      ),
    ).toMatchObject({ allowed: false });
    expect(await readFleetAuthoritySites(client, vendor.id)).toEqual([]);
  } finally {
    client.release();
  }
});
