/**
 * Production smoke: field-employee ticket create + vendor ticket read.
 * Uses canonical demo accounts against live API (https://vndrly.ai).
 */
const BASE = process.env.SMOKE_BASE_URL ?? "https://vndrly.ai";

async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const bodyText = await res.text();
  let body: { token?: string } = {};
  try {
    body = JSON.parse(bodyText) as typeof body;
  } catch {
    /* plain text */
  }
  if (!res.ok) {
    throw new Error(`login ${username} failed: ${res.status} ${bodyText.slice(0, 200)}`);
  }
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookieMatch = setCookie.match(/vndrly_session=[^;]+/);
  if (cookieMatch) return cookieMatch[0];
  if (body.token) return `vndrly_session=${body.token}`;
  throw new Error(`login ${username} succeeded but no session cookie or token`);
}

async function api(
  cookie: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Cookie: cookie,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { status: res.status, json };
}

async function fieldTicketFlow() {
  const cookie = await login("joe.boggs@winchester.com", "winchester2");
  console.log("OK field employee login (joe.boggs)");

  const sites = await api(cookie, "/api/field/sites");
  if (sites.status !== 200) {
    throw new Error(`field/sites ${sites.status} ${JSON.stringify(sites.json).slice(0, 300)}`);
  }
  const siteList = sites.json as Array<{ id: number; name: string; isActive?: boolean }>;
  if (!siteList?.length) throw new Error("No field sites for Winchester");
  const activeSite = siteList.find((s) => s.isActive !== false) ?? siteList[0];
  console.log(`OK field sites (${siteList.length}), site ${activeSite.id}`);

  const workTypes = await api(cookie, `/api/field/sites/${activeSite.id}/work-types`);
  if (workTypes.status !== 200) {
    throw new Error(
      `work-types ${workTypes.status} ${JSON.stringify(workTypes.json).slice(0, 300)}`,
    );
  }
  const wtList = workTypes.json as Array<{ id: number; name: string }>;
  if (!wtList?.length) throw new Error("No work types on site");
  const wt = wtList[0];
  console.log(`OK work types, using ${wt.id} ${wt.name}`);

  const create = await api(cookie, "/api/field/tickets", {
    method: "POST",
    body: JSON.stringify({
      siteLocationId: activeSite.id,
      workTypeId: wt.id,
      initialState: "pending_arrival",
      description: "production-smoke-lifecycle",
    }),
  });
  if (create.status === 409) {
    const msg = JSON.stringify(create.json);
    if (msg.includes("safety.site_inactive")) {
      throw new Error(`BLOCKED: site ${activeSite.id} inactive — ${msg}`);
    }
  }
  if (create.status !== 200 && create.status !== 201) {
    throw new Error(
      `field/tickets ${create.status} ${JSON.stringify(create.json).slice(0, 400)}`,
    );
  }
  const ticket = create.json as { id?: number; status?: string; lifecycleState?: string };
  if (!ticket.id) throw new Error("field create missing ticket id");
  console.log(
    `OK field ticket create id=${ticket.id} status=${ticket.status} lifecycle=${ticket.lifecycleState}`,
  );

  const detail = await api(cookie, `/api/tickets/${ticket.id}`);
  if (detail.status !== 200) {
    throw new Error(`ticket detail ${detail.status}`);
  }
  console.log("OK field ticket detail");

  return ticket.id;
}

async function vendorReadFlow(ticketId: number) {
  const cookie = await login("winchester", "winchester2");
  console.log("OK vendor login (winchester)");

  const detail = await api(cookie, `/api/tickets/${ticketId}`);
  if (detail.status !== 200) {
    throw new Error(`vendor ticket read ${detail.status}`);
  }
  console.log("OK vendor can read field-created ticket");
}

async function main() {
  console.log(`Smoke base: ${BASE}`);

  const health = await fetch(`${BASE}/api/healthz`);
  if (!health.ok) throw new Error(`healthz ${health.status}`);
  console.log("OK healthz");

  const ticketId = await fieldTicketFlow();
  await vendorReadFlow(ticketId);

  console.log("\n=== Production ticket lifecycle smoke PASSED ===");
}

main().catch((err) => {
  console.error("\n=== Production ticket lifecycle smoke FAILED ===");
  console.error(err);
  process.exit(1);
});
