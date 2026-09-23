import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { pool } from "@workspace/db";
import { readFile } from "node:fs/promises";
import {
  changeOverTransaction,
  startGateShift,
  prepareGateHandoff,
  transferGateShift,
  getChangeOverState,
  getShiftNotes,
  actOnShiftItem,
  cancelGateHandoff,
  recoverGateShift,
  requireChangeOverAccess,
  listChangeOverSites,
  listChangeOverStations,
} from "./gate-change-over";
import type { SessionPayload } from "../lib/session";
import { buildTestCookie } from "../test-utils/session";
import gateChangeOverRouter from "../routes/gateChangeOver";
import { runOpsDataTool } from "../assistant/data-tools-ops";

const app = express();
app.use(express.json(), cookieParser(), gateChangeOverRouter);
async function fixture() {
  const key = randomUUID();
  const partner = (
    await pool.query(
      "INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Test','test@example.invalid') RETURNING id",
      [`Shift partner ${key}`],
    )
  ).rows[0].id;
  const vendor = (
    await pool.query(
      "INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Test','test@example.invalid') RETURNING id",
      [`Shift vendor ${key}`],
    )
  ).rows[0].id;
  const site = (
    await pool.query(
      "INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) VALUES($1,'Test gate site','Test',30,-100,$2) RETURNING id",
      [partner, key],
    )
  ).rows[0].id;
  const work = (
    await pool.query(
      "INSERT INTO work_types(name,category) VALUES($1,'gate') RETURNING id",
      [key],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id) VALUES($1,$2,$3)",
    [site, work, vendor],
  );
  const station = (
    await pool.query(
      "INSERT INTO gate_stations(site_id,name) VALUES($1,'Test gate') RETURNING id",
      [site],
    )
  ).rows[0].id;
  const sessions: SessionPayload[] = [];
  const usernames: string[] = [];
  for (const role of ["gatekeeper", "gatekeeper", "gate_supervisor"]) {
    const username = `${role}-${randomUUID()}`;
    usernames.push(username);
    const user = (
      await pool.query(
        "INSERT INTO users(username,password_hash,role,display_name) VALUES($1,$2,'vendor',$1) RETURNING id",
        [username, await bcrypt.hash("local-fixture-password", 4)],
      )
    ).rows[0].id;
    const person = (
      await pool.query(
        "INSERT INTO vendor_people(vendor_id,user_id,vendor_role,first_name,email) VALUES($1,$2,$3,'Gate','test@example.invalid') RETURNING id",
        [vendor, user, role],
      )
    ).rows[0].id;
    const membership = (
      await pool.query(
        "INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role,vendor_people_id) VALUES($1,'vendor',$2,'member',$3) RETURNING id",
        [user, vendor, person],
      )
    ).rows[0].id;
    sessions.push({
      userId: user,
      role: "vendor",
      vendorId: vendor,
      vendorRole: role,
      membershipRole: "member",
      activeMembershipId: membership,
      sv: 1,
    });
  }
  const [outgoing, incoming, supervisor] = sessions as [
    SessionPayload,
    SessionPayload,
    SessionPayload,
  ];
  await startGateShift(outgoing, station);
  const prepare = () =>
    prepareGateHandoff(
      outgoing,
      station,
      "Check north barrier",
      async (facts) => ({
        source: "structured_facts",
        facts: facts.slice(0, 3),
      }),
    );
  const transfer = (prep: any) =>
    transferGateShift(outgoing, incoming, {
      stationId: station,
      preparationId: prep.id,
      revision: prep.snapshot.revision,
      operationId: randomUUID(),
      acknowledged: true,
    });
  return {
    site,
    station,
    vendor,
    outgoing,
    incoming,
    supervisor,
    usernames,
    prepare,
    transfer,
  };
}

describe("Change Over database guarantees", () => {
  beforeAll(async () => {
    if (
      process.env.VNDRLY_TEST_DB_MODE !== "fresh-local" &&
      process.env.VNDRLY_ISOLATED_TEST_DB !== "1"
    )
      throw new Error(
        "Run Change Over integration tests through the isolated database wrapper",
      );
    const migration = await readFile(
      new URL(
        "../../../../lib/db/drizzle/gate_change_over.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await pool.query(migration);
    await pool.query(migration);
  });
  it("rolls back all work on a failed transfer transaction", async () => {
    await expect(
      changeOverTransaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(813451)");
        await client.query("CREATE TABLE change_over_rollback_probe (id int)");
        throw new Error("simulated failure");
      }),
    ).rejects.toThrow("simulated failure");
    const result = await pool.query(
      "SELECT to_regclass('change_over_rollback_probe') AS relation",
    );
    expect(result.rows[0].relation).toBeNull();
  });
  it("enables RLS on all private handoff tables", async () => {
    const result = await pool.query(
      "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('gate_stations','gate_shifts','gate_preparations','gate_handovers','gate_shift_actions')",
    );
    expect(result.rows).toHaveLength(5);
    expect(result.rows.every((row) => row.relrowsecurity)).toBe(true);
  });
  it("allows removing an unused site but protects sites with recorded shifts", async () => {
    const f = await fixture();
    const unused = (
      await pool.query(
        "INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) SELECT partner_id,'Unused gate site','Fixture',30,-100,$2 FROM site_locations WHERE id=$1 RETURNING id",
        [f.site, randomUUID()],
      )
    ).rows[0].id;
    expect(
      (
        await pool.query("SELECT id FROM gate_stations WHERE site_id=$1", [
          unused,
        ])
      ).rowCount,
    ).toBe(1);
    await pool.query("DELETE FROM site_locations WHERE id=$1", [unused]);
    expect(
      (
        await pool.query("SELECT id FROM gate_stations WHERE site_id=$1", [
          unused,
        ])
      ).rowCount,
    ).toBe(0);
    await expect(
      pool.query("DELETE FROM gate_stations WHERE id=$1", [f.station]),
    ).rejects.toThrow(/foreign key/);
  });
  it("lists only an operator's current site and sites with an active or future assigned shift", async () => {
    const f = await fixture();
    const scheduledSite = (
      await pool.query(
        "INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) SELECT partner_id,'Scheduled gate site','Fixture',30,-100,$2 FROM site_locations WHERE id=$1 RETURNING id",
        [f.site, randomUUID()],
      )
    ).rows[0].id;
    const unrelatedSite = (
      await pool.query(
        "INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) SELECT partner_id,'Unrelated gate site','Fixture',30,-100,$2 FROM site_locations WHERE id=$1 RETURNING id",
        [f.site, randomUUID()],
      )
    ).rows[0].id;
    const workTypeId = (
      await pool.query(
        "SELECT work_type_id FROM site_work_assignments WHERE site_location_id=$1 AND vendor_id=$2 LIMIT 1",
        [f.site, f.vendor],
      )
    ).rows[0].work_type_id;
    await pool.query(
      "INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id) VALUES($1,$3,$2),($4,$3,$2)",
      [scheduledSite, f.vendor, workTypeId, unrelatedSite],
    );
    const shiftId = (
      await pool.query(
        `INSERT INTO work_hub_shifts(owner_org_type,owner_org_id,title,starts_at,ends_at,timezone,site_location_id,gate_station_id,created_by_id)
         VALUES('vendor',$1,'Scheduled gate shift',now()+interval '1 hour',now()+interval '9 hours','America/Chicago',$2,$3,$4)
         RETURNING id`,
        [
          f.vendor,
          scheduledSite,
          (
            await pool.query(
              "INSERT INTO gate_stations(site_id,name) VALUES($1,'Scheduled gate') RETURNING id",
              [scheduledSite],
            )
          ).rows[0].id,
          f.supervisor.userId,
        ],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO work_hub_shift_assignments(shift_id,user_id,status,assigned_by_id) VALUES($1,$2,'assigned',$3)",
      [shiftId, f.outgoing.userId, f.supervisor.userId],
    );

    const sites = await listChangeOverSites(f.outgoing);
    expect(sites.map((site) => site.id).sort((a, b) => a - b)).toEqual(
      [f.site, scheduledSite].sort((a, b) => a - b),
    );
    expect(sites.some((site) => site.id === unrelatedSite)).toBe(false);
    await pool.query(
      "INSERT INTO gate_stations(site_id,name) VALUES($1,'Unassigned gate')",
      [scheduledSite],
    );
    const stations = await listChangeOverStations(f.outgoing, scheduledSite);
    expect(stations.map((station) => station.name)).toEqual(["Scheduled gate"]);
  });
  it("grounds askV field answers in current state and refuses unrelated sites", async () => {
    const f = await fixture();
    const other = await fixture();
    await actOnShiftItem(
      f.outgoing,
      f.station,
      randomUUID(),
      "open",
      "Inspect north barrier",
    );
    const answer = JSON.parse(
      await runOpsDataTool(
        "query_gate_change_over",
        { stationId: f.station },
        f.incoming,
      ),
    );
    expect(answer.snapshot.openItems[0].text).toBe("Inspect north barrier");
    expect(answer.snapshot.generatedAt).toBeTruthy();
    const denied = JSON.parse(
      await runOpsDataTool(
        "query_gate_change_over",
        { stationId: other.station },
        f.incoming,
      ),
    );
    expect(denied.error).toBeTruthy();
    expect(denied.snapshot).toBeUndefined();
    await f.transfer(await f.prepare());
    const history = JSON.parse(
      await runOpsDataTool(
        "query_shift_notes",
        { stationId: f.station, search: "north barrier" },
        f.incoming,
      ),
    );
    expect(history.rows).toHaveLength(1);
    await pool.query(
      "UPDATE vendor_people SET is_active=false WHERE user_id=$1",
      [f.incoming.userId],
    );
    expect(
      JSON.parse(
        await runOpsDataTool(
          "query_shift_notes",
          { stationId: f.station },
          f.incoming,
        ),
      ).error,
    ).toBeTruthy();
  });
  it("transfers and acknowledges atomically, revokes the outgoing session and preserves immutable history", async () => {
    const f = await fixture();
    const prep = await f.prepare();
    const result = await f.transfer(prep);
    const current = await getChangeOverState(f.incoming, f.station);
    expect(current.shift.operator_id).toBe(f.incoming.userId);
    expect(current.shift.id).toBe(result.incoming_shift_id);
    await expect(
      getChangeOverState(f.outgoing, f.station),
    ).rejects.toMatchObject({ status: 401 });
    const history = await getShiftNotes(f.incoming, { stationId: f.station });
    expect(history.rows[0].notes).toBe("Check north barrier");
    expect(history.rows[0].incoming_user_id).toBe(f.incoming.userId);
    await expect(
      pool.query("UPDATE gate_preparations SET notes='edited' WHERE id=$1", [
        prep.id,
      ]),
    ).rejects.toThrow("immutable");
    await expect(
      pool.query("DELETE FROM gate_handovers WHERE id=$1", [result.id]),
    ).rejects.toThrow("immutable");
  });
  it("rejects a handoff after source activity changes without closing its shift or session", async () => {
    const f = await fixture();
    const prep = await f.prepare();
    await pool.query(
      "INSERT INTO site_visits(site_location_id,first_name,last_name,host_type) VALUES($1,'New','Visitor','partner')",
      [f.site],
    );
    await expect(f.transfer(prep)).rejects.toMatchObject({
      code: "change_over.stale",
    });
    const state = await getChangeOverState(f.outgoing, f.station);
    expect(state.shift.operator_id).toBe(f.outgoing.userId);
    expect(state.stale).toBe(true);
  });
  it("rejects a stale prepared pointer after refresh or supervisor cancellation", async () => {
    const f = await fixture();
    const old = await f.prepare();
    await f.prepare();
    await expect(f.transfer(old)).rejects.toMatchObject({
      code: "change_over.shift_changed",
    });
    await cancelGateHandoff(
      f.supervisor,
      f.station,
      "Outgoing operator left the booth",
    );
    expect(
      (await getChangeOverState(f.outgoing, f.station)).preparation,
    ).toBeNull();
  });
  it("allows only a supervisor to recover an abandoned shift and preserves the audit trail", async () => {
    const f = await fixture();
    await f.prepare();
    const old = (await getChangeOverState(f.supervisor, f.station)).shift;
    await expect(
      recoverGateShift(f.incoming, f.station, old.id, "Absent operator"),
    ).rejects.toMatchObject({ status: 403 });
    await pool.query("UPDATE users SET suspended_at=now() WHERE id=$1", [
      f.outgoing.userId,
    ]);
    await recoverGateShift(
      f.supervisor,
      f.station,
      old.id,
      "Absent operator; reviewed gate facts",
    );
    expect(
      (await getChangeOverState(f.supervisor, f.station)).shift.operator_id,
    ).toBe(f.supervisor.userId);
    const log = await getShiftNotes(f.supervisor, { stationId: f.station });
    expect(log.rows[0].notes).toContain("Supervisor recovery");
    expect(log.rows[0].notes).toContain("Check north barrier");
    expect(log.actions[0].kind).toBe("recovery");
    await expect(
      recoverGateShift(f.supervisor, f.station, old.id, "Retry"),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("permits exactly one winner when two transfers race", async () => {
    const f = await fixture();
    const prep = await f.prepare();
    const results = await Promise.allSettled([
      f.transfer(prep),
      f.transfer(prep),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (
        await pool.query(
          "SELECT id FROM gate_shifts WHERE station_id=$1 AND ended_at IS NULL",
          [f.station],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("rejects assignment removal, inactive gate staff and wrong-site access", async () => {
    const f = await fixture();
    const other = await fixture();
    await expect(
      requireChangeOverAccess(pool, f.incoming, other.site),
    ).rejects.toMatchObject({ status: 403 });
    await pool.query(
      "UPDATE vendor_people SET is_active=false WHERE user_id=$1",
      [f.incoming.userId],
    );
    await expect(
      requireChangeOverAccess(pool, f.incoming, f.site),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("carries open actions forward and keeps resolution history without rewriting the handoff", async () => {
    const f = await fixture();
    const itemId = randomUUID();
    await actOnShiftItem(
      f.outgoing,
      f.station,
      itemId,
      "open",
      "Inspect barrier",
    );
    const prep = await f.prepare();
    await f.transfer(prep);
    expect(
      (await getChangeOverState(f.incoming, f.station)).items,
    ).toContainEqual({ id: itemId, text: "Inspect barrier", status: "open" });
    await actOnShiftItem(
      f.incoming,
      f.station,
      itemId,
      "resolve",
      "Barrier inspected",
    );
    expect(
      (await getChangeOverState(f.incoming, f.station)).items[0].status,
    ).toBe("resolved");
    expect(
      (await getShiftNotes(f.incoming, { stationId: f.station })).rows[0]
        .snapshot.openItems[0].status,
    ).toBe("open");
  });
  it("failed incoming credentials leave the outgoing session and shift intact", async () => {
    const f = await fixture();
    const prep = await f.prepare();
    const response = await request(app)
      .post(`/gate-change-over/${f.station}/authenticate`)
      .set("Cookie", buildTestCookie(f.outgoing))
      .send({
        username: f.usernames[1],
        password: "wrong",
        preparationId: prep.id,
        revision: prep.snapshot.revision,
      });
    expect(response.status).toBe(401);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(
      (await getChangeOverState(f.outgoing, f.station)).shift.operator_id,
    ).toBe(f.outgoing.userId);
  });
  it("authenticates without switching, then requires acknowledgment to switch", async () => {
    const f = await fixture();
    const prep = await f.prepare();
    const cookie = buildTestCookie(f.outgoing);
    const auth = await request(app)
      .post(`/gate-change-over/${f.station}/authenticate`)
      .set("Cookie", cookie)
      .send({
        username: f.usernames[1],
        password: "local-fixture-password",
        preparationId: prep.id,
        revision: prep.snapshot.revision,
      });
    expect(auth.status).toBe(200);
    expect(auth.headers["set-cookie"]).toBeUndefined();
    const rejected = await request(app)
      .post(`/gate-change-over/${f.station}/transfer`)
      .set("Cookie", cookie)
      .send({
        proof: auth.body.proof,
        operationId: randomUUID(),
        acknowledged: false,
      });
    expect(rejected.status).toBe(400);
    const accepted = await request(app)
      .post(`/gate-change-over/${f.station}/transfer`)
      .set("Cookie", cookie)
      .send({
        proof: auth.body.proof,
        operationId: randomUUID(),
        acknowledged: true,
      });
    expect(accepted.status).toBe(200);
    expect(accepted.body.user.id).toBe(f.incoming.userId);
    expect(accepted.headers["set-cookie"]).toBeDefined();
  });
  it("rolls back shift closure and creation when the handover insert fails", async () => {
    const f = await fixture();
    const prep = await f.prepare();
    const operationId = randomUUID();
    const constraint = `handover_failure_${operationId.replaceAll("-", "")}`;
    await pool.query(
      `ALTER TABLE gate_handovers ADD CONSTRAINT ${constraint} CHECK (id <> '${operationId}'::uuid) NOT VALID`,
    );
    await expect(
      transferGateShift(f.outgoing, f.incoming, {
        stationId: f.station,
        preparationId: prep.id,
        revision: prep.snapshot.revision,
        operationId,
        acknowledged: true,
      }),
    ).rejects.toThrow();
    const state = await getChangeOverState(f.outgoing, f.station);
    expect(state.shift.operator_id).toBe(f.outgoing.userId);
    expect(
      (
        await pool.query("SELECT id FROM gate_shifts WHERE station_id=$1", [
          f.station,
        ])
      ).rows,
    ).toHaveLength(1);
    expect(
      (await getShiftNotes(f.outgoing, { stationId: f.station })).rows,
    ).toHaveLength(0);
  });
  it("expires snapshots and refuses self-transfer", async () => {
    const f = await fixture();
    const prep = await f.prepare();
    await expect(
      transferGateShift(f.outgoing, f.outgoing, {
        stationId: f.station,
        preparationId: prep.id,
        revision: prep.snapshot.revision,
        operationId: randomUUID(),
        acknowledged: true,
      }),
    ).rejects.toMatchObject({ status: 400 });
    // Prepare an old immutable snapshot through the same table contract; no
    // historical row is edited to manufacture the fixture.
    const old = (
      await pool.query(
        "INSERT INTO gate_preparations(shift_id,prepared_by,snapshot,notes,summary,created_at) SELECT shift_id,prepared_by,snapshot,notes,summary,now()-interval '6 minutes' FROM gate_preparations WHERE id=$1 RETURNING *",
        [prep.id],
      )
    ).rows[0];
    await pool.query("UPDATE gate_shifts SET preparation_id=$1 WHERE id=$2", [
      old.id,
      old.shift_id,
    ]);
    await expect(f.transfer(old)).rejects.toMatchObject({
      code: "change_over.stale",
    });
  });
});
