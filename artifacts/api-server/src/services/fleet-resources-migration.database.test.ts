import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { describe, expect, it } from "vitest";

describe("additive Fleet resource migration", () => {
  it("can run twice without changing company data or Inventory", async () => {
    const sentinel = { fleets: [{ name: "Preserved permission group" }], enabled: true };
    const inserted = await pool.query("INSERT INTO vendors (name,contact_name,contact_email,fleet_ops_state) VALUES ($1,$2,$3,$4::jsonb) RETURNING id", ["Migration fixture", "Synthetic", `migration-${randomUUID()}@example.invalid`, JSON.stringify(sentinel)]);
    const id = inserted.rows[0].id;
    const before = await pool.query("SELECT to_jsonb(v) AS vendor FROM vendors v WHERE id=$1", [id]);
    const assetsBefore = await pool.query("SELECT count(*)::text AS count FROM assets");
    for (const script of ["apply-fleet-resources.ts", "apply-fleet-compliance.ts"]) {
      const migration = fileURLToPath(new URL(`../../../../lib/db/src/scripts/${script}`, import.meta.url));
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = spawnSync(process.execPath, ["--import", "tsx", migration], { env: { ...process.env, VNDRLY_LOAD_ENV_LOCAL: "0" }, encoding: "utf8", timeout: 30000, windowsHide: true });
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
      }
    }
    const after = await pool.query("SELECT to_jsonb(v) AS vendor FROM vendors v WHERE id=$1", [id]);
    expect(after.rows).toEqual(before.rows);
    expect((await pool.query("SELECT count(*)::text AS count FROM assets")).rows).toEqual(assetsBefore.rows);
    expect((await pool.query("SELECT fleet_resources FROM vendors WHERE id=$1", [id])).rows[0].fleet_resources).toBeNull();
  });
});
