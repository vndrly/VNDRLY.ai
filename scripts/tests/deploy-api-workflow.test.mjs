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
  assert.match(workflow, /"scripts\/assistant-action-audit-migration\.mjs"/);

  for (const secret of ["VPS_HOST", "VPS_USER", "VPS_PASSWORD", "VPS_PORT", "ASSEMBLYAI_API_KEY"]) {
    assert.match(workflow, new RegExp(`secrets\\.${secret}`));
  }
});

test("API deploy transfers the meeting transcription key without logging it and activates the bounded provider", () => {
  assert.match(workflow, /printf '%s' "\$ASSEMBLYAI_API_KEY" \| sshpass -e ssh/);
  assert.match(workflow, /cat > \/tmp\/vndrly-assemblyai-key/);
  assert.match(workflow, /trap '[^']*vndrly-assemblyai-key[^']*' EXIT/);
  assert.match(workflow, /VNDRLY_MEETING_STT_PROVIDER=assemblyai/);
  assert.match(workflow, /ASSEMBLYAI_MODEL_TRAINING_ALLOWED=1/);
  assert.match(workflow, /ASSEMBLYAI_MAX_CONCURRENT_STREAMS=5/);
  assert.doesNotMatch(workflow, /echo[^\n]*ASSEMBLYAI_API_KEY/);
});

test("API deploy builds, migrates, restarts, and health-checks without touching web or nginx", () => {
  assert.match(workflow, /git fetch origin main/);
  assert.match(workflow, /git diff --exit-code --quiet/);
  assert.match(workflow, /git diff --cached --exit-code --quiet/);
  assert.match(workflow, /git switch --detach ["']?\$EXPECTED_SHA["']?/);
  assert.doesNotMatch(workflow, /git reset --hard/);
  assert.match(workflow, /pnpm --filter @workspace\/api-server run build/);
  assert.match(workflow, /migrate:plate-state/);
  assert.match(workflow, /migrate:notes-admission/);
  for (const migration of ["vendor-note-ownership", "visit-entry-category", "partner-owned-catalogs"]) {
    assert.ok(workflow.indexOf(`migrate:${migration}`) > 0);
    assert.ok(workflow.indexOf(`migrate:${migration}`) < workflow.indexOf("systemctl restart vndrly-api"));
  }
  assert.ok(workflow.indexOf('migrate:askv-greeting') > 0);
  assert.ok(workflow.indexOf('migrate:askv-greeting') < workflow.indexOf('systemctl restart vndrly-api'));
  assert.match(workflow, /systemctl restart vndrly-api/);
  assert.match(workflow, /vndrly\.ai\/api\/healthz/);
  assert.match(workflow, /ASKV_NATURAL_VOICE_ENABLED=1/);
  assert.match(workflow, /grep[^\n]+ASKV_NATURAL_VOICE_ENABLED/);
  assert.match(workflow, /ASKV_NATURAL_VOICE_USER_IDS/);
  assert.match(workflow, /sed[^\n]+ASKV_NATURAL_VOICE_USER_IDS[^\n]+\.env\.production/);

  assert.doesNotMatch(workflow, /rsync/);
  assert.doesNotMatch(workflow, /nginx|certbot/);
  assert.doesNotMatch(workflow, /drizzle(?:-kit)?\s+push/i);
  assert.doesNotMatch(workflow, /\b(?:DROP|TRUNCATE)\b/i);
  assert.doesNotMatch(workflow, /tee \.env\.production/);
});

test("API deploy configures the VNDRLY-owned TURN relay before restarting meetings", () => {
  const provision = 'sudo bash scripts/provision-work-hub-audio.sh "$RELAY_HOST"';
  assert.ok(workflow.includes(provision));
  assert.ok(workflow.indexOf(provision) < workflow.indexOf("systemctl restart vndrly-api"));
  assert.doesNotMatch(workflow, /VNDRLY_TURN_CREDENTIAL|\/etc\/turnserver\.conf/);
  for (const migration of ["work-hub-collaboration", "work-hub-calls", "work-hub-scheduling", "work-hub-finance", "work-hub-file-library", "work-hub-meeting-collaboration"]) {
    assert.ok(workflow.includes(`migrate:${migration}`));
    assert.ok(workflow.indexOf(`migrate:${migration}`) < workflow.indexOf("systemctl restart vndrly-api"));
  }
});
