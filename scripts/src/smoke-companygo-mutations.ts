import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";

const BASE = process.env.SMOKE_BASE_URL ?? "https://vndrly.ai";
const PASSWORD = "companygo";
const marker = process.env.SMOKE_MARKER ?? `[COMPANYGO-SMOKE:${new Date().toISOString()}]`;

async function login(username: string) {
  const response = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PASSWORD }) });
  if (!response.ok) throw new Error(`${username} login failed: ${response.status} ${await response.text()}`);
  const cookie = response.headers.get("set-cookie")?.match(/vndrly_session=[^;]+/)?.[0];
  if (!cookie) throw new Error(`${username} login returned no session`);
  return cookie;
}

async function api(cookie: string, method: string, path: string, body?: unknown, expected = [200, 201]) {
  const response = await fetch(`${BASE}${path}`, { method, headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let payload: any = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!expected.includes(response.status)) throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 800)}`);
  return { status: response.status, payload };
}

async function main() {
  const siteResult = await pool.query(`select id, latitude, longitude from site_locations where partner_id=614 and is_active=true order by id limit 1`);
  const site = siteResult.rows[0];
  if (!site) throw new Error("CompanyGo site missing");

  const [fieldCookie, partnerCookie, partnerOfficeCookie, gateCookie] = await Promise.all([
    login("vendor_field@fieldgo.com"), login("partner_admin@gasgo.com"), login("partner_office@gasgo.com"), login("vendor_gatekeeper@gatego.com"),
  ]);
  const workTypes = (await api(fieldCookie, "GET", `/api/field/sites/${site.id}/work-types`)).payload;
  if (!Array.isArray(workTypes) || !workTypes[0]?.id) throw new Error("No assigned FieldGo work type found");
  const created = await api(fieldCookie, "POST", "/api/field/tickets", {
    siteLocationId: site.id, workTypeId: workTypes[0].id, latitude: Number(site.latitude), longitude: Number(site.longitude),
    description: `${marker} full ticket lifecycle`, initialState: "pending_arrival", startingMileage: 41000,
  });
  const ticketId = created.payload.id;
  if (!ticketId) throw new Error(`Ticket create returned no id: ${JSON.stringify(created.payload)}`);
  await api(fieldCookie, "POST", `/api/tickets/${ticketId}/en-route`, { latitude: Number(site.latitude) + 0.01, longitude: Number(site.longitude), startingMileage: 41000 });
  await api(fieldCookie, "POST", `/api/tickets/${ticketId}/on-location`, { latitude: Number(site.latitude), longitude: Number(site.longitude) });
  await api(fieldCookie, "POST", `/api/tickets/${ticketId}/check-in`, { latitude: Number(site.latitude), longitude: Number(site.longitude) });
  await api(fieldCookie, "POST", `/api/tickets/${ticketId}/check-out`, { latitude: Number(site.latitude), longitude: Number(site.longitude), workCompleted: false, endingMileage: 41012.5 });
  await api(fieldCookie, "POST", `/api/tickets/${ticketId}/submit`, {});
  const approval = await api(partnerCookie, "POST", `/api/tickets/${ticketId}/approve`, {}, [200, 409]);

  let payment: { status: number; payload: any } | null = null;
  if (approval.status === 200) {
    payment = await api(partnerCookie, "POST", `/api/tickets/${ticketId}/disperse-funds`, {
      paymentMethod: "other", paymentReference: `SMOKE-${ticketId}`, note: `${marker} synthetic payment; no external transfer`,
    });
  }

  const gateMap = (await api(gateCookie, "GET", "/api/gate-change-over/map")).payload;
  const gate = gateMap?.gates?.find((item: any) => item.siteId === site.id) ?? gateMap?.gates?.[0];
  if (!gate?.id) throw new Error("No GateGo station available");
  const duty = await api(gateCookie, "POST", `/api/gate-change-over/${gate.id}/duty/assume`, {
    source: "web", idempotencyKey: randomUUID(),
  });

  const plate = `CG${String(Date.now()).slice(-6)}`;
  const gateIn = await api(gateCookie, "POST", "/api/visits/gate/check-in", {
    firstName: "FieldGo", lastName: "Crew", company: "FieldGo", siteLocationId: site.id,
    purpose: `${marker} gate workflow for FieldGo ticket #${ticketId}`, entryCategory: "routine_vendor_work", expectedDurationMinutes: 30,
    vehiclePlate: plate, plateState: "TX", notes: marker, latitude: Number(site.latitude), longitude: Number(site.longitude),
  });
  const visitId = gateIn.payload.id;
  await api(gateCookie, "POST", `/api/visits/gate/${visitId}/check-out`, { latitude: Number(site.latitude), longitude: Number(site.longitude), notes: `${marker} checkout` });

  const dutyId = duty.payload?.id;
  const dutyEnd = dutyId
    ? await api(gateCookie, "POST", `/api/gate-change-over/${gate.id}/duty/${dutyId}/end`, { reason: `${marker} smoke complete`, handoffCompleted: false }, [200, 409])
    : null;

  const partnerOffice = (await api(partnerOfficeCookie, "GET", "/api/auth/me")).payload;
  const owner = { type: "partner", id: 614 };
  const context = { kind: "organization", id: 614 };
  const command = (payload: unknown) => ({ operationId: randomUUID(), owner, context, expectedVersion: null, payloadVersion: 1, payload });
  const channel = await api(partnerCookie, "POST", "/api/work-hub/channels", {
    ...command({ name: `${marker} dispatch`, visibility: "organization" }),
  });
  const channelId = channel.payload?.resource?.id;
  if (!channelId) throw new Error(`Channel create returned no id: ${JSON.stringify(channel.payload)}`);
  await api(partnerCookie, "POST", `/api/work-hub/channels/${channelId}/members`, { email: "partner_office@gasgo.com" });
  const message = await api(partnerCookie, "POST", `/api/work-hub/channels/${channelId}/messages`, command({ body: `${marker} dispatch coordination`, kind: "text", mentionUserIds: [partnerOffice.userId] }));
  const messageId = message.payload?.resource?.id;
  await api(partnerOfficeCookie, "GET", `/api/work-hub/channels/${channelId}/messages`);
  if (messageId) await api(partnerOfficeCookie, "POST", `/api/work-hub/channels/${channelId}/messages/${messageId}/reactions`, command({ emoji: "✅" }));
  const task = await api(partnerCookie, "POST", "/api/work-hub/tasks", command({ title: `${marker} verify dispatch`, description: "Synthetic CompanyGo workflow test", assigneeUserId: partnerOffice.userId, dueAt: new Date(Date.now() + 86_400_000).toISOString(), priority: "normal", channelId }));

  console.log(JSON.stringify({ marker, ticketId, ticketSubmitted: true, approvalStatus: approval.status, paymentStatus: payment?.payload?.status ?? payment?.payload?.resource?.status ?? payment?.status ?? null, gateVisitId: visitId, gateWorkflow: "complete", dutyEndStatus: dutyEnd?.status ?? null, workHubChannelId: channelId, workHubMessageId: messageId, workHubTaskId: task.payload?.resource?.id }, null, 2));
  if (approval.status !== 200) process.exitCode = 3;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
