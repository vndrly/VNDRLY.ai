import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(root, "../src");
const host = "localhost";
const port = 5173;

function fetchModule(urlPath) {
  return new Promise((resolve) => {
    http
      .get(`http://${host}:${port}${urlPath}`, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      })
      .on("error", (err) => resolve({ status: 0, body: String(err) }));
  });
}

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(full);
  }
  return out;
}

const deleted = [
  "toggle-pill",
  "baker-pill-button",
  "pick-toggle-pill",
  "pick-pill-for-brand",
  "ticket-status-toggle-pill",
  "rollover-button",
  "/components/pill",
];

const files = walk(srcRoot);
const importRe =
  /from\s+["']@\/(?:components|lib|pages|hooks)\/([^"']+)["']/g;

const toCheck = new Set(["/src/App.tsx", "/src/main.tsx"]);
for (const file of files) {
  const rel = path.relative(srcRoot, file).replace(/\\/g, "/");
  const text = fs.readFileSync(file, "utf8");
  if (deleted.some((d) => text.includes(d) && !text.includes("//") && text.match(new RegExp(`from ["']@/.*${d.replace("/", "\\/")}`)))) {
    console.error(`STALE IMPORT in src/${rel}`);
    process.exit(1);
  }
  for (const m of text.matchAll(importRe)) {
    let p = `/src/${m[0].includes("/pages/") ? "pages/" : m[0].includes("/components/") ? "components/" : m[0].includes("/hooks/") ? "hooks/" : "lib/"}${m[1]}`;
    if (!p.endsWith(".tsx") && !p.endsWith(".ts")) {
      const base = path.join(srcRoot, m[1].replace(/^pages\//, "pages/").replace(/^components\//, "components/"));
      if (fs.existsSync(base + ".tsx")) p += ".tsx";
      else if (fs.existsSync(base + ".ts")) p += ".ts";
      else p += ".tsx";
    }
  }
}

// Always verify App + every page/component imported by App
const appText = fs.readFileSync(path.join(srcRoot, "App.tsx"), "utf8");
for (const m of appText.matchAll(/from\s+["']@\/([^"']+)["']/g)) {
  let rel = m[1];
  if (!rel.endsWith(".tsx") && !rel.endsWith(".ts")) {
    const base = path.join(srcRoot, rel);
    if (fs.existsSync(base + ".tsx")) rel += ".tsx";
    else if (fs.existsSync(base + ".ts")) rel += ".ts";
    else rel += ".tsx";
  }
  toCheck.add(`/src/${rel}`);
}

const failures = [];
for (const mod of [...toCheck].sort()) {
  const { status, body } = await fetchModule(mod);
  const broken =
    status !== 200 ||
    body.includes("Pre-transform error") ||
    body.includes("Failed to resolve") ||
    body.includes("Does the file exist") ||
    body.includes("toggle-pill") ||
    body.includes("baker-pill-button");
  if (broken) failures.push({ mod, status, snippet: body.slice(0, 200) });
}

console.log(`Checked ${toCheck.size} Vite modules on :${port}`);
if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error(JSON.stringify(f, null, 2));
  process.exit(1);
}
console.log("All modules compile — no deleted pill imports in App graph.");
