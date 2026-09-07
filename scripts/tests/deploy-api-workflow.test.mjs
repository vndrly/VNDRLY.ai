import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL(
  "../../.github/workflows/deploy-api.yml",
  import.meta.url,
);

const workflow = await readFile(workflowUrl, "utf8");

test("API deploy is a separate main workflow with guarded VPS access", () => {
  assert.match(workflow, /^name:\s*Deploy API\s*$/m);
  assert.match(workflow, /^\s*workflow_dispatch:\s*$/m);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /artifacts\/api-server\/\*\*/);
  assert.match(workflow, /lib\/db\/drizzle\/\*\*/);
  assert.match(workflow, /"scripts\/askv-greeting-migration\.mjs"/);

  for (const secret of ["VPS_HOST", "VPS_USER", "VPS_PASSWORD", "VPS_PORT"]) {
    assert.match(workflow, new RegExp(`secrets\\.${secret}`));
  }
});

test("API deploy builds, migrates, restarts, and health-checks without touching web or nginx", () => {
  assert.match(workflow, /git fetch origin main/);
  assert.match(workflow, /git reset --hard ["']?\$EXPECTED_SHA["']?/);
  assert.match(workflow, /pnpm --filter @workspace\/api-server run build/);
  assert.match(workflow, /migrate:plate-state/);
  assert.match(workflow, /migrate:notes-admission/);
  assert.ok(workflow.indexOf('migrate:askv-greeting') > 0);
  assert.ok(workflow.indexOf('migrate:askv-greeting') < workflow.indexOf('systemctl restart vndrly-api'));
  assert.match(workflow, /systemctl restart vndrly-api/);
  assert.match(workflow, /vndrly\.ai\/api\/healthz/);

  assert.doesNotMatch(workflow, /rsync/);
  assert.doesNotMatch(workflow, /nginx|certbot/);
  assert.doesNotMatch(workflow, /drizzle(?:-kit)?\s+push/i);
  assert.doesNotMatch(workflow, /\b(?:DROP|TRUNCATE)\b/i);
  assert.doesNotMatch(workflow, /tee \.env\.production/);
});
