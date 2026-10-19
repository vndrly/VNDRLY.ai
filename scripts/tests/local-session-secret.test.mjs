import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scripts = fileURLToPath(new URL("../", import.meta.url));

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "vndrly-local-session-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "scripts"));
  for (const file of ["dev-local-defaults.mjs", "local-session-secret.mjs"]) {
    if (existsSync(path.join(scripts, file))) copyFileSync(path.join(scripts, file), path.join(root, "scripts", file));
  }
  return root;
}

function launch(root, extraEnv = {}) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    await import("./scripts/dev-local-defaults.mjs");
    assert.ok(process.env.SESSION_SECRET !== "simulated-production-key-from-parent", "inherited production key must be replaced");
    assert.ok(process.env.SESSION_SECRET !== "simulated-production-key-from-env-file", "env-file production key must be replaced");
    assert.match(process.env.SESSION_SECRET, /^[a-f0-9]{64}$/);
    assert.equal(process.env.VITE_SESSION_SECRET, undefined);
    assert.equal(process.env.EXPO_PUBLIC_SESSION_SECRET, undefined);
    assert.equal(process.env.PORT, "8080");
    assert.equal(process.env.VITE_API_PROXY_TARGET, "http://localhost:8080");
  `], { cwd: root, env: { ...process.env, ...extraEnv, PORT: "8080", VITE_API_PROXY_TARGET: "http://localhost:8080" }, encoding: "utf8" });
}

test("local previews replace an inherited production key and share a stable local key across launches", (t) => {
  const root = fixture(t);
  const first = launch(root, { SESSION_SECRET: "simulated-production-key-from-parent" });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, "");
  const keyFile = path.join(root, ".local", "dev-session-secret");
  const key = readFileSync(keyFile, "utf8");
  const second = launch(root, { SESSION_SECRET: "simulated-production-key-from-env-file" });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, "");
  assert.ok(readFileSync(keyFile, "utf8") === key, "relaunch must preserve local sessions");
});

test("separate checkouts get different local keys", (t) => {
  const first = fixture(t), second = fixture(t);
  assert.equal(launch(first).status, 0);
  assert.equal(launch(second).status, 0);
  assert.ok(readFileSync(path.join(first, ".local", "dev-session-secret"), "utf8") !== readFileSync(path.join(second, ".local", "dev-session-secret"), "utf8"));
});

test("an invalid local key stops startup without falling back to an inherited key or printing its value", (t) => {
  const root = fixture(t);
  mkdirSync(path.join(root, ".local"));
  writeFileSync(path.join(root, ".local", "dev-session-secret"), "invalid-private-file-content");
  const result = launch(root, { SESSION_SECRET: "simulated-production-key-from-parent" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid local session key/);
  assert.ok(!result.stderr.includes("invalid-private-file-content"));
  assert.ok(!result.stderr.includes("simulated-production-key-from-parent"));
});

test("public session-secret aliases are stripped before bundlers inherit the environment", (t) => {
  const root = fixture(t);
  const result = launch(root, { VITE_SESSION_SECRET: "simulated-production-key-from-parent", EXPO_PUBLIC_SESSION_SECRET: "simulated-production-key-from-parent" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("all local preview launchers isolate the key before spawning", () => {
  for (const name of ["run-api-local.mjs", "run-vite-local.mjs", "run-expo-local.mjs", "run-expo-ios-local.mjs", "run-production-api.mjs", "run-production-web.mjs"]) {
    const source = readFileSync(path.join(scripts, name), "utf8");
    const guard = source.indexOf("./dev-local-defaults.mjs") >= 0
      ? source.indexOf("./dev-local-defaults.mjs") : source.indexOf("./local-session-secret.mjs");
    assert.ok(guard > source.indexOf("./load-env-local.mjs"), `${name} must replace the key after environment loading`);
    assert.ok(guard < source.indexOf("spawn("), `${name} must isolate the key before spawning`);
  }
});

test("the built API package start uses the guarded local wrapper while VPS starts the API directly", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../artifacts/api-server/package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.start, "node ../../scripts/run-production-api.mjs");
  const service = readFileSync(path.join(scripts, "server", "bootstrap-vps.sh"), "utf8");
  assert.match(service, /EnvironmentFile=\$APP_DIR\/\.env\.production/);
  assert.match(service, /ExecStart=\/usr\/bin\/node --enable-source-maps \$APP_DIR\/artifacts\/api-server\/dist\/index\.mjs/);
});

test("a secret loaded from a local env file is replaced before preview code runs", (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, ".env.local"), "SESSION_SECRET=simulated-production-key-from-env-file\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    delete process.env.SESSION_SECRET;
    process.loadEnvFile(".env.local");
    assert.ok(process.env.SESSION_SECRET === "simulated-production-key-from-env-file");
    await import("./scripts/dev-local-defaults.mjs");
    assert.ok(process.env.SESSION_SECRET !== "simulated-production-key-from-env-file");
    assert.match(process.env.SESSION_SECRET, /^[a-f0-9]{64}$/);
  `], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("isolated test fixtures retain only their known inert key; test flags never preserve an unknown inherited key", (t) => {
  const root = fixture(t);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    await import("./scripts/dev-local-defaults.mjs");
    assert.ok(process.env.SESSION_SECRET === "test-secret");
  `], { cwd: root, env: { ...process.env, VNDRLY_TEST_DB_MODE: "fresh-local", VNDRLY_ISOLATED_TEST_DB: "1", SESSION_SECRET: "test-secret" }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const unknown = launch(root, { VNDRLY_TEST_DB_MODE: "fresh-local", VNDRLY_ISOLATED_TEST_DB: "1", SESSION_SECRET: "simulated-production-key-from-parent" });
  assert.equal(unknown.status, 0, unknown.stderr);
});
