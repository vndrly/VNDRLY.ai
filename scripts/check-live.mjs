#!/usr/bin/env node
/** Post-deploy smoke checks for https://vndrly.ai */
const urls = [
  { url: "https://vndrly.ai/api/healthz", expectStatus: 200, expectBody: "ok" },
  { url: "https://vndrly.ai/login", expectStatus: 200, expectBody: "<!DOCTYPE html>" },
  {
    url: "https://vndrly.ai/api/platform-settings/public-brand",
    expectStatus: 401,
    expectBody: "auth.unauthenticated",
  },
];

let failed = 0;
for (const { url, expectStatus, expectBody } of urls) {
  try {
    const r = await fetch(url);
    const text = await r.text();
    const ok =
      r.status === expectStatus &&
      (expectBody ? text.includes(expectBody) : true);
    console.log(url, r.status, ok ? "OK" : "UNEXPECTED", text.slice(0, 100));
    if (!ok) failed++;
  } catch (e) {
    console.log(url, "FAIL", e.message);
    failed++;
  }
}
process.exit(failed > 0 ? 1 : 0);
