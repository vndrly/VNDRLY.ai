import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { beforeAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import {
  assumeGateDuty,
  endGateDuty,
  getGateRoster,
  startWorkSession,
} from "./gate-duty";

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function fixture(policy: "on_site" | "paid_travel" = "on_site") {
  const key = randomUUID();
  const partner = (
    await pool.query(
      "INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Gate Test','gate@example.invalid') RETURNING id",
      [`Duty partner ${key}`],
    )
  ).rows[0].id as number;
  const vendor = (
    await pool.query(
      "INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Gate Test','gate@example.invalid') RETURNING id",
      [`Duty vendor ${key}`],
    )
  ).rows[0].id as number;
  const site = (
    await pool.query(
      "INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) VALUES($1,'Duty site','Fixture',30,-100,$2) RETURNING id",
      [partner, key],
    )
  ).rows[0].id as number;
  const workType = (
    await pool.query(
      "INSERT INTO work_types(name,category) VALUES($1,'gate') RETURNING id",
      [`Duty ${key}`],
    )
  ).rows[0].id as number;
  await pool.query(
    "INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id) VALUES($1,$2,$3)",
    [site, workType, vendor],
  );
  const stationId = (
    await pool.query(
      "INSERT INTO gate_stations(site_id,name) VALUES($1,$2) RETURNING id",
      [site, `Main gate ${key}`],
    )
  ).rows[0].id as string;

  const workers: SessionPayload[] = [];
  for (const suffix of ["bob", "chad", "sam"]) {
    const username = `duty-${suffix}-${randomUUID()}`;
    const userId = (
      await pool.query(
        "INSERT INTO users(username,password_hash,role,display_name) VALUES($1,$2,'vendor',$3) RETURNING id",
        [username, await bcrypt.hash("fixture-password", 4), suffix],
      )
    ).rows[0].id as number;
    const personId = (
      await pool.query(
        "INSERT INTO vendor_people(vendor_id,user_id,vendor_role,first_name,email) VALUES($1,$2,'gatekeeper',$3,$4) RETURNING id",
        [vendor, userId, suffix, `${username}@example.invalid`],
      )
    ).rows[0].id as number;
    const membershipId = (
      await pool.query(
        "INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role,vendor_people_id) VALUES($1,'vendor',$2,'member',$3) RETURNING id",
        [userId, vendor, personId],
      )
    ).rows[0].id as number;
    workers.push({
      userId,
      role: "vendor",
      vendorId: vendor,
      vendorRole: "gatekeeper",
      membershipRole: "member",
      activeMembershipId: membershipId,
      sv: 1,
    });
  }
  const shiftId = (
    await pool.query(
      `INSERT INTO work_hub_shifts(
        owner_org_type,owner_org_id,title,starts_at,ends_at,timezone,
        site_location_id,gate_station_id,required_staff_count,work_start_policy,created_by_id
      ) VALUES('vendor',$1,$2,now()-interval '1 hour',now()+interval '11 hours','America/Chicago',$3,$4,2,$5,$6)
      RETURNING id`,
      [vendor, `Gate shift ${key}`, site, stationId, policy, workers[0]!.userId],
    )
  ).rows[0].id as string;
  await pool.query(
    "INSERT INTO work_hub_shift_assignments(shift_id,user_id,status,assigned_by_id) VALUES($1,$2,'assigned',$2),($1,$3,'assigned',$2)",
    [shiftId, workers[0]!.userId, workers[1]!.userId],
  );
  return { site, vendor, stationId, shiftId, workers };
}

const key = () => randomUUID();

describe("Gate duty teams", () => {
  beforeAll(() => {
    if (process.env.VNDRLY_ISOLATED_TEST_DB !== "1") {
      throw new Error("Run Gate duty tests through the isolated database wrapper");
    }
  });

  it("allows two workers to assume one station and ends only the caller", async () => {
    const f = await fixture();
    const bob = await assumeGateDuty(f.workers[0]!, {
      stationId: f.stationId,
      workHubShiftId: f.shiftId,
      source: "web",
      idempotencyKey: key(),
    });
    const chad = await assumeGateDuty(f.workers[1]!, {
      stationId: f.stationId,
      workHubShiftId: f.shiftId,
      source: "ios",
      idempotencyKey: key(),
    });
    await endGateDuty(f.workers[0]!, {
      dutySessionId: bob.id,
      reason: "Relieved for appointment",
      handoffCompleted: false,
    });
    expect(await getGateRoster(f.workers[1]!, f.stationId)).toMatchObject([
      { id: chad.id, userId: f.workers[1]!.userId },
    ]);
  });

  it("returns the same duty record for an idempotent retry", async () => {
    const f = await fixture();
    const idempotencyKey = key();
    const input = {
      stationId: f.stationId,
      workHubShiftId: f.shiftId,
      source: "askv" as const,
      idempotencyKey,
    };
    const first = await assumeGateDuty(f.workers[0]!, input);
    const retry = await assumeGateDuty(f.workers[0]!, input);
    expect(retry.id).toBe(first.id);
  });

  it("rejects a worker who is not assigned to the selected Work Hub shift", async () => {
    const f = await fixture();
    await expect(
      assumeGateDuty(f.workers[2]!, {
        stationId: f.stationId,
        workHubShiftId: f.shiftId,
        source: "web",
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ code: "change_over.assignment_required" });
  });

  it("starts on-site work and duty together", async () => {
    const f = await fixture("on_site");
    const result = await startWorkSession(f.workers[0]!, {
      workHubShiftId: f.shiftId,
      stationId: f.stationId,
      source: "ios",
      idempotencyKey: key(),
    });
    expect(result.workSession.startPolicy).toBe("on_site");
    expect(result.dutySession).toMatchObject({ stationId: f.stationId });
  });

  it("starts paid travel without putting the worker on gate duty", async () => {
    const f = await fixture("paid_travel");
    const result = await startWorkSession(f.workers[0]!, {
      workHubShiftId: f.shiftId,
      stationId: f.stationId,
      source: "ios",
      idempotencyKey: key(),
      locationSharingActive: true,
    });
    expect(result.workSession).toMatchObject({
      startPolicy: "paid_travel",
      travelStatus: "en_route",
      locationSharingActive: true,
    });
    expect(result.dutySession).toBeNull();
  });

  it("requires a completed handoff when the last worker leaves", async () => {
    const f = await fixture();
    const duty = await assumeGateDuty(f.workers[0]!, {
      stationId: f.stationId,
      workHubShiftId: f.shiftId,
      source: "web",
      idempotencyKey: key(),
    });
    await expect(
      endGateDuty(f.workers[0]!, {
        dutySessionId: duty.id,
        reason: "Shift ended",
        handoffCompleted: false,
      }),
    ).rejects.toMatchObject({ code: "change_over.handoff_required" });
    await expect(
      endGateDuty(f.workers[0]!, {
        dutySessionId: duty.id,
        reason: "Shift ended",
        handoffCompleted: true,
      }),
    ).resolves.toMatchObject({ id: duty.id });
  });
});
