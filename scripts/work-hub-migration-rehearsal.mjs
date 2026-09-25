import assert from "node:assert/strict";

const newFields = ["asset_custody_events.command_fingerprint", ...["latitude", "longitude", "geofence_radius_m", "active", "version"].map(name => `gate_stations.${name}`)];

/** inspect and migrate operate only on the caller's freshly provisioned local database. */
export async function rehearseWorkHubMigrations({ inspect, migrate }) {
  const before = await inspect();
  assert.ok(before.fields.includes("gate_stations.id") && before.fields.includes("asset_custody_events.id"), "Previous schema tables missing");
  assert.ok(newFields.every(field => !before.fields.includes(field)) && !before.gateIndex, "First application requires the previous schema, not current-schema replay");
  for (const pass of ["first application", "replay"]) {
    await migrate("migrate:asset-custody-fingerprint");
    await migrate("migrate:gate-locations");
    const after = await inspect();
    assert.ok(newFields.every(field => after.fields.includes(field)), `${pass}: migration fields missing`);
    assert.ok(after.gateIndex, `${pass}: gate index missing`);
    assert.equal(after.originalRows, before.originalRows, `${pass}: original rows changed`);
  }
}
