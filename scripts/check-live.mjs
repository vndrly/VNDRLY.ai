#!/usr/bin/env node
/** Post-deploy smoke checks for https://vndrly.ai */
const BASE = process.env.VNDRLY_LIVE_BASE || "https://vndrly.ai";
const APEX = new URL(BASE).origin;

let failed = 0;

function record(ok, label, detail = "") {
  console.log(ok ? "OK" : "FAIL", label, detail);
  if (!ok) failed++;
}

async function expectFetch(url, { method = "GET", status, body, contentType } = {}) {
  const r = await fetch(url, {
    method,
    headers: { "Accept-Encoding": "gzip, br" },
    redirect: "manual",
  });
  const text = method === "HEAD" ? "" : await r.text();
  record(
    r.status === status &&
      (!body || text.includes(body)) &&
      (!contentType || (r.headers.get("content-type") || "").includes(contentType)),
    `${method} ${url}`,
    `status=${r.status} type=${r.headers.get("content-type") || ""} body=${text.slice(0, 80)}`,
  );
  return { r, text };
}

async function expectRedirect(url, locationPrefix) {
  const r = await fetch(url, { redirect: "manual" });
  const location = r.headers.get("location") || "";
  record(
    [301, 308].includes(r.status) && location.startsWith(locationPrefix),
    `redirect ${url}`,
    `status=${r.status} location=${location}`,
  );
}

await expectRedirect("http://vndrly.ai/", "https://vndrly.ai/");
await expectRedirect("https://www.vndrly.ai/", "https://vndrly.ai/");

await expectFetch(`${APEX}/api/healthz`, { status: 200, body: "ok", contentType: "application/json" });
await expectFetch(`${APEX}/login`, { status: 200, body: "<!DOCTYPE html>", contentType: "text/html" });
await expectFetch(`${APEX}/api/platform-settings/public-brand`, {
  status: 401,
  body: "auth.unauthenticated",
  contentType: "application/json",
});

for (const path of ["/sitemap.xml", "/manifest.json", "/.well-known/security.txt"]) {
  const expectedType = path.endsWith(".xml")
    ? "xml"
    : path.endsWith(".json")
      ? "json"
      : "text/plain";
  const { text } = await expectFetch(`${APEX}${path}`, { status: 200, contentType: expectedType });
  record(!text.includes('<div id="root"></div>'), `static document ${path}`, "not SPA shell");
}

const loginHead = await expectFetch(`${APEX}/login`, { method: "HEAD", status: 200 });
for (const header of [
  "strict-transport-security",
  "x-content-type-options",
  "referrer-policy",
  "content-security-policy",
]) {
  record(Boolean(loginHead.r.headers.get(header)), `security header ${header}`);
}

const htmlCache = loginHead.r.headers.get("cache-control") || "";
record(/no-cache|no-store|max-age=0/i.test(htmlCache), "html cache policy", htmlCache);

const publicSites = await fetch(`${APEX}/api/visits/public-sites`);
const sites = await publicSites.json();
record(publicSites.status === 200 && Array.isArray(sites), "public sites endpoint status", `count=${sites.length}`);
record(sites.length <= 50, "public sites capped", `count=${sites.length}`);
record(
  sites.every((s) => Math.abs(Number(s.latitude) * 100 - Math.round(Number(s.latitude) * 100)) < 1e-9),
  "public site coordinates rounded",
);

process.exit(failed > 0 ? 1 : 0);
