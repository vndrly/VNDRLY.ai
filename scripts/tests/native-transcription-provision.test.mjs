import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const bash = process.env.BASH_BIN || (process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash");
const script = fileURLToPath(new URL("../provision-native-transcription.sh", import.meta.url));
const shellPath = (path) => path.replace(/\\/g, "/");
function run(args) { return spawnSync(bash, [shellPath(script), ...args], { encoding: "utf8" }); }

test("resource admission rejects missing headroom before any provisioning", () => {
  for (const [memory, disk, cores, load] of [
    [1_000_000, 4_000_000, 4, 0], [2_000_000, 1_000_000, 4, 0],
    [2_000_000, 4_000_000, 0, 0], [2_000_000, 4_000_000, 4, 3],
  ]) {
    const result = run(["--check-headroom", `${memory}`, `${disk}`, `${cores}`, `${load}`]);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /headroom/i);
  }
  const admitted = run(["--check-headroom", "3000000", "4000000", "8", "1"]);
  assert.equal(admitted.status, 0, admitted.stdout + admitted.stderr);
  assert.equal(run(["--check-headroom", "1432576", "30000000", "1", "0.1"]).status, 0, "a small VPS may install and benchmark; timing still controls activation");
});

test("smoke admission requires recognized speech, speed, and memory headroom", () => {
  const folder = mkdtempSync(join(tmpdir(), "vndrly-speech-test-"));
  try {
    const transcript = join(folder, "sample.txt");
    const metrics = join(folder, "sample.metrics");
    writeFileSync(transcript, "And so, my fellow Americans, ask not what your country can do for you.");
    writeFileSync(metrics, "7.20 350000\n");
    const check = () => run(["--check-smoke", shellPath(transcript), shellPath(metrics), "3000000"]);
    assert.equal(check().status, 0);
    writeFileSync(metrics, "9.00 350000\n");
    assert.notEqual(check().status, 0, "must leave 20% processing headroom on the eleven-second sample");
    writeFileSync(metrics, "7.20 1500000\n");
    assert.notEqual(check().status, 0, "two workers must leave memory for the app");
    writeFileSync(metrics, "7.20 350000\n");
    writeFileSync(transcript, "silence or a broken model");
    assert.notEqual(check().status, 0, "zero exit code alone is not a passing transcription");
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test("verified activation preserves unrelated environment settings and is idempotent", () => {
  const folder = mkdtempSync(join(tmpdir(), "vndrly-speech-env-test-"));
  const env = join(folder, ".env.production");
  const binary = "/opt/vndrly-speech/whisper-v1.8.3-2eeeba56/bin/whisper-cli";
  const model = "/opt/vndrly-speech/models/ggml-base-60ed5bc3dd14.bin";
  try {
    writeFileSync(env, "# existing application config\nDATABASE_URL=preserve-this-placeholder\nOTHER_FLAG=yes\n");
    const command = 'source "$1"; chown() { :; }; speech_update_environment "$2" "$3" "$4" /usr/bin/ffmpeg';
    const invoke = () => spawnSync(bash, ["-c", command, "speech-test", shellPath(script), shellPath(env), binary, model], { encoding: "utf8" });
    const first = invoke();
    assert.equal(first.status, 0, first.stderr);
    const activated = readFileSync(env, "utf8");
    assert.match(activated, /^DATABASE_URL=preserve-this-placeholder$/m);
    assert.match(activated, /^OTHER_FLAG=yes$/m);
    assert.match(activated, /^VNDRLY_NATIVE_TRANSCRIBE_ENABLED=1$/m);
    assert.match(activated, /^VNDRLY_WHISPER_BIN=\/opt\/vndrly-speech\//m);
    assert.equal(invoke().status, 0);
    assert.equal(readFileSync(env, "utf8"), activated);
    writeFileSync(env, activated + "VNDRLY_WHISPER_BIN=/custom/keep\n");
    const duplicate = readFileSync(env, "utf8");
    assert.notEqual(invoke().status, 0);
    assert.equal(readFileSync(env, "utf8"), duplicate, "ambiguous existing configuration must be preserved");
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test("unknown modes cannot provision or enable transcription", () => {
  const result = run(["--surprise"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /usage/i);
});

test("failed concurrent smoke leaves activation disabled", () => {
  const folder = mkdtempSync(join(tmpdir(), "vndrly-speech-activation-test-"));
  const env = join(folder, ".env.production");
  try {
    writeFileSync(env, "UNCHANGED=value\nVNDRLY_NATIVE_TRANSCRIBE_ENABLED=0\n");
    for (const worker of ["first", "second"]) {
      writeFileSync(join(folder, `${worker}.txt`), "ask not what your country can do for you");
      writeFileSync(join(folder, `${worker}.metrics`), worker === "first" ? "7.2 350000\n" : "20.0 350000\n");
    }
    const command = 'source "$1"; chown() { :; }; speech_activate_after_smoke "$2" /opt/vndrly-speech/bin /opt/vndrly-speech/model /usr/bin/ffmpeg "$3" 3000000';
    const invoke = () => spawnSync(bash, ["-c", command, "speech-test", shellPath(script), shellPath(env), shellPath(folder)], { encoding: "utf8" });
    assert.notEqual(invoke().status, 0);
    assert.equal(readFileSync(env, "utf8"), "UNCHANGED=value\nVNDRLY_NATIVE_TRANSCRIBE_ENABLED=0\n");
    writeFileSync(join(folder, "second.metrics"), "7.2 350000\n");
    const success = invoke();
    assert.equal(success.status, 0, success.stderr);
    assert.match(readFileSync(env, "utf8"), /^VNDRLY_NATIVE_TRANSCRIBE_ENABLED=1$/m);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
