import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const buildId = process.argv[2];
if (!buildId) {
  console.error("Usage: node fetch-eas-log.mjs <build-id>");
  process.exit(1);
}

const raw = execSync(`npx.cmd eas-cli@19.1.0 build:view ${buildId} --json`, {
  encoding: "utf8",
});
const json = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
const url = json.artifacts?.xcodeBuildLogsUrl ?? json.logFiles?.at(-1);
if (!url) {
  console.error("No log URL found");
  process.exit(1);
}

const res = await fetch(url);
const text = await res.text();
writeFileSync("xcode.log", text);
const hits = text
  .split("\n")
  .filter((line) => /error:|failed|fatal|❌|BUILD FAILED/i.test(line));
console.log(`log bytes: ${text.length}`);
console.log(hits.slice(-40).join("\n") || text.slice(-4000));
