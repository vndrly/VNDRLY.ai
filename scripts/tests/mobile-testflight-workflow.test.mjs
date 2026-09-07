import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../../.github/workflows/mobile-testflight.yml", import.meta.url),
  "utf8",
);

test("TestFlight is a dispatchable GitHub Actions job using Expo, not PowerShell", () => {
  assert.match(workflow, /^name:\s*Publish Mobile TestFlight\s*$/m);
  assert.match(workflow, /^\s*workflow_dispatch:\s*$/m);
  assert.match(workflow, /secrets\.EXPO_TOKEN/);
  assert.match(workflow, /eas whoami\s*$/m);
  assert.doesNotMatch(workflow, /eas whoami --non-interactive/);
  assert.match(
    workflow,
    /eas build[\s\S]*--platform ios[\s\S]*--profile production[\s\S]*--non-interactive/,
  );
  assert.match(workflow, /BUILD_MESSAGE:\s*\$\{\{ inputs\.message \}\}/);
  assert.match(workflow, /--message "\$BUILD_MESSAGE \(\$GITHUB_SHA\)"/);
  assert.match(workflow, /eas submit[\s\S]*--platform ios[\s\S]*--non-interactive/);
  assert.doesNotMatch(workflow, /testflight-build\.ps1|ship-it\.ps1/);
});

test("OTA authentication uses the installed CLI's flag-free noninteractive account lookup", async () => {
  const ota = await readFile(new URL('../../.github/workflows/mobile-ota.yml', import.meta.url), 'utf8');
  assert.match(ota, /eas whoami\s*$/m);
  assert.doesNotMatch(ota, /eas whoami --non-interactive/);
});

test("TestFlight builds the full VCS snapshot and submits its verified exact build", () => {
  assert.doesNotMatch(workflow, /EAS_NO_VCS|--latest|--auto-submit/);
  assert.match(workflow, /--freeze-credentials/);
  assert.match(workflow, /git rev-parse --show-toplevel/);
  assert.match(workflow, /git rev-parse HEAD/);
  assert.match(workflow, /--json > "\$RUNNER_TEMP\/eas-ios-build\.json"/);
  assert.match(workflow, /verify-eas-ios-build\.mjs/);
  assert.match(workflow, /eas build:view "\$build_id" --json/);
  assert.match(workflow, /--id "\$EAS_BUILD_ID"/);
  assert.doesNotMatch(workflow, /--message[^\n]*\$\{\{/);
});

test("TestFlight workflow does not rewrite production data or skip native gates", () => {
  assert.doesNotMatch(workflow, /DATABASE_URL|\.env\.production/);
  assert.doesNotMatch(workflow, /\b(?:DROP|TRUNCATE)\b/i);
  assert.doesNotMatch(workflow, /--skip-tests|AllowNativeChanges/i);
});
