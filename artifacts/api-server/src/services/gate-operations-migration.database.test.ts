import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

async function applySql(fileName: string) {
  const sql = await readFile(
    new URL(`../../../../lib/db/drizzle/${fileName}`, import.meta.url),
    "utf8",
  );
  await pool.query(sql);
}

async function createLegacyActiveShift() {
  const key = randomUUID();
  const partnerId = (
    await pool.query(
      "INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Gate test','gate-test@example.invalid') RETURNING id",
      [`Gate operations partner ${key}`],
    )
  ).rows[0].id;
  const siteId = (
    await pool.query(
      "INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code) VALUES($1,$2,'Test',30,-100,$3) RETURNING id",
      [partnerId, `Gate operations site ${key}`, key],
    )
  ).rows[0].id;
  const userId = (
    await pool.query(
      "INSERT INTO users(username,password_hash,role,display_name) VALUES($1,'test-hash','vendor',$1) RETURNING id",
      [`gate-operations-${key}`],
    )
  ).rows[0].id;
  const stationId = (
    await pool.query(
      "SELECT id FROM gate_stations WHERE site_id=$1 AND name='Main gate'",
      [siteId],
    )
  ).rows[0].id;
  const shiftId = (
    await pool.query(
      "INSERT INTO gate_shifts(station_id,operator_id) VALUES($1,$2) RETURNING id",
      [stationId, userId],
    )
  ).rows[0].id;
  return { shiftId, stationId, userId };
}

describe("Gate operations migration", () => {
  beforeAll(async () => {
    if (
      process.env.VNDRLY_TEST_DB_MODE !== "fresh-local" &&
      process.env.VNDRLY_ISOLATED_TEST_DB !== "1"
    ) {
      throw new Error("Run Gate operations migration tests through the isolated database wrapper");
    }
    await applySql("gate_change_over.sql");
  });

  it("replays additively and preserves an existing active Gate shift", async () => {
    const legacy = await createLegacyActiveShift();

    await applySql("gate_operations_command_center.sql");
    await applySql("gate_operations_command_center.sql");

    const shift = await pool.query(
      "SELECT ended_at FROM gate_shifts WHERE id=$1",
      [legacy.shiftId],
    );
    expect(shift.rows[0].ended_at).toBeNull();

    const duty = await pool.query(
      "SELECT station_id,user_id,source_legacy_shift_id,ended_at FROM gate_duty_sessions WHERE source_legacy_shift_id=$1",
      [legacy.shiftId],
    );
    expect(duty.rows).toEqual([
      expect.objectContaining({
        station_id: legacy.stationId,
        user_id: legacy.userId,
        source_legacy_shift_id: legacy.shiftId,
        ended_at: null,
      }),
    ]);
  });

  it("creates every private operations table with row-level security enabled", async () => {
    await applySql("gate_operations_command_center.sql");
    const result = await pool.query(
      `SELECT relname, relrowsecurity FROM pg_class
       WHERE relname = ANY($1::text[])
       ORDER BY relname`,
      [[
        "gate_attendance_exceptions",
        "gate_coverage_status",
        "gate_duty_sessions",
        "gate_report_deliveries",
        "gate_visit_reconciliations",
        "gate_work_sessions",
      ]],
    );
    expect(result.rows).toHaveLength(6);
    expect(result.rows.every((row) => row.relrowsecurity)).toBe(true);
  });
});
