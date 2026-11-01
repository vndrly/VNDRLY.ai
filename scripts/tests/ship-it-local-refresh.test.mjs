import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shipScript = readFileSync(
  new URL("../ship-it.ps1", import.meta.url),
  "utf8",
);

test("full ship replaces both local servers with the deployed checkout", () => {
  assert.match(
    shipScript,
    /ensure-local-dev\.ps1"\) -Recover -Strict/,
    "full ship must force-restart both Vite and the API after deployment",
  );
});

test("ship success cannot precede the nine-track completion gate", () => {
  const gate = shipScript.indexOf('"scripts/release-handoff-gate.mjs"');
  const success = shipScript.indexOf('Write-ShipSuccess -Summary');
  assert.ok(gate >= 0 && gate < success);
  assert.match(shipScript.slice(gate, success), /\$LASTEXITCODE -ne 0/);
  assert.match(shipScript.slice(gate, success), /Fail-Ship/);
});
