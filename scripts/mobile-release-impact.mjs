#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function collectDiffFiles(baseRef = null) {
  const files = new Set();

  const commands = baseRef
    ? [
        ["diff", "--name-only", baseRef, "--"],
        ["ls-files", "--others", "--exclude-standard"],
      ]
    : [
        ["diff", "--name-only"],
        ["diff", "--name-only", "--cached"],
        ["ls-files", "--others", "--exclude-standard"],
      ];

  for (const args of commands) {
    const out = git(args);
    for (const file of out.split(/\r?\n/)) {
      if (file.trim()) files.add(file.trim().replaceAll("\\", "/"));
    }
  }

  return [...files].sort();
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

const nativeExact = new Set([
  "artifacts/vndrly-mobile/app.json",
  "artifacts/vndrly-mobile/eas.json",
  "artifacts/vndrly-mobile/metro.config.js",
  "artifacts/vndrly-mobile/babel.config.js",
  "eas.json",
  "scripts/prepare-askv-ios.mjs",
]);

const packageJsonFiles = [
  "package.json",
  "artifacts/vndrly-mobile/package.json",
];

function isWorkspaceProtocol(value) {
  return typeof value === "string" && value.startsWith("workspace:");
}

const nativePrefixes = [
  "artifacts/vndrly-mobile/plugins/",
  "artifacts/vndrly-mobile/modules/",
  "artifacts/vndrly-mobile/assets/askv-wake/",
  "artifacts/vndrly-mobile/ios/",
  "artifacts/vndrly-mobile/android/",
  "artifacts/vndrly-mobile/assets/icons/",
  "artifacts/vndrly-mobile/assets/sounds/",
];

const nativeSuffixes = [
  ".p8",
  ".mobileprovision",
  ".entitlements",
  ".keystore",
  ".jks",
];

function readJsonAtRef(ref, file) {
  try {
    return JSON.parse(git(["show", `${ref}:${file}`]));
  } catch {
    return null;
  }
}

function readWorkingJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, file), "utf8"));
  } catch {
    return null;
  }
}

const dependencyKeys = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "resolutions",
  "overrides",
  "packageManager",
];

function collectDependencyEntries(pkg) {
  const entries = new Map();
  if (!pkg || typeof pkg !== "object") return entries;
  for (const key of dependencyKeys) {
    const block = pkg[key];
    if (key === "packageManager") {
      if (typeof block === "string") entries.set(key, block);
      continue;
    }
    if (!block || typeof block !== "object") continue;
    for (const [name, version] of Object.entries(block)) {
      entries.set(`${key}:${name}`, version);
    }
  }
  return entries;
}

function classifyPackageDependencyChange(file, baseRef = null) {
  const before = readJsonAtRef(baseRef ?? "HEAD", file);
  const after = readWorkingJson(file);
  if (!before && !after) return "none";
  if (!before || !after) return "native";

  const beforeMap = collectDependencyEntries(before);
  const afterMap = collectDependencyEntries(after);
  const names = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  let sawWorkspace = false;

  for (const name of names) {
    const previous = beforeMap.get(name);
    const next = afterMap.get(name);
    if (JSON.stringify(previous ?? null) === JSON.stringify(next ?? null)) {
      continue;
    }
    if (
      (previous === undefined && isWorkspaceProtocol(next)) ||
      (next === undefined && isWorkspaceProtocol(previous)) ||
      (isWorkspaceProtocol(previous) && isWorkspaceProtocol(next))
    ) {
      sawWorkspace = true;
      continue;
    }
    return "native";
  }

  return sawWorkspace ? "workspace-only" : "none";
}

function lockfileRequiresNativeBuild(baseRef = null) {
  const classes = packageJsonFiles.map((file) =>
    classifyPackageDependencyChange(file, baseRef),
  );
  if (classes.includes("native")) return true;
  if (classes.includes("workspace-only")) return false;
  return true;
}

function isNativeImpact(file, baseRef = null) {
  if (packageJsonFiles.includes(file)) {
    return classifyPackageDependencyChange(file, baseRef) === "native";
  }
  if (file === "pnpm-lock.yaml") {
    return lockfileRequiresNativeBuild(baseRef);
  }
  if (nativeExact.has(file)) return true;
  if (nativePrefixes.some((prefix) => file.startsWith(prefix))) return true;
  return nativeSuffixes.some((suffix) => file.endsWith(suffix));
}

const baseRef = readArg("--base-ref");
if (baseRef) git(["rev-parse", "--verify", `${baseRef}^{commit}`]);
const githubOutputMode = process.argv.includes("--github-output");

const files = collectDiffFiles(baseRef);
const mobileFiles = files.filter(
  (file) =>
    file.startsWith("artifacts/vndrly-mobile/") ||
    file.startsWith("lib/") ||
    file.startsWith("packages/") ||
    nativeExact.has(file) ||
    file === "pnpm-lock.yaml" ||
    file === "package.json",
);
const nativeImpactFiles = mobileFiles.filter((file) => isNativeImpact(file, baseRef));

if (process.argv.includes("--json")) {
  console.log(
    JSON.stringify(
      {
        files,
        mobileFiles,
        nativeImpactFiles,
        requiresNativeBuild: nativeImpactFiles.length > 0,
      },
      null,
      2,
    ),
  );
} else {
  if (mobileFiles.length === 0) {
    console.log("No mobile-impacting local changes detected.");
  } else {
    console.log("Mobile-impacting local changes:");
    for (const file of mobileFiles) console.log(`  - ${file}`);
  }

  if (nativeImpactFiles.length > 0) {
    console.log("");
    console.log("Native/TestFlight-required changes:");
    for (const file of nativeImpactFiles) console.log(`  - ${file}`);
  }
}

if (githubOutputMode) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT is required with --github-output.");
  }
  fs.appendFileSync(
    outputPath,
    `requires_native_build=${nativeImpactFiles.length > 0}\n`,
  );
  process.exit(0);
}

process.exit(nativeImpactFiles.length > 0 ? 2 : 0);
