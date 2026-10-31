import { test, expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createPool, hashPassword, makeStamp } from "../helpers/db";
import { createVendor, createUser, createUserOrgMembership, setActiveMembership } from "../helpers/fixtures";
import { loginAsVendor } from "../helpers/auth";

// Host plus two attendees driven through the live-meeting API with real
// sessions. Soft assertions so one run reports every broken meeting function.
test("host admits, moderates, removes and ends a live meeting with two attendees", async ({ browser }) => {
  test.setTimeout(180_000);
  const pool = createPool();
  const stamp = makeStamp();
  const password = "MeetingFixtureOnly-2026";
  const contexts = [] as Awaited<ReturnType<typeof browser.newContext>>[];
  try {
    const vendor = await createVendor(pool, { name: `Example Meeting ${stamp}`, contactName: "Meeting Example", contactEmail: `meeting-${stamp}@example.invalid` });
    const people: Array<{ id: number; username: string }> = [];
    for (const [label, role] of [["host", "admin"], ["alpha", "member"], ["bravo", "member"]] as const) {
      const username = `meeting-${label}-${stamp}@example.invalid`;
      const user = await createUser(pool, { username, email: username, passwordHash: hashPassword(password), role: "vendor", displayName: `Example ${label} ${stamp}` });
      const membership = await createUserOrgMembership(pool, { userId: user.id, orgType: "vendor", vendorId: vendor.id, role });
      await setActiveMembership(pool, { userId: user.id, membershipId: membership.id });
      await pool.query(
        "INSERT INTO work_hub_meeting_participation_authorizations(user_id, policy_version, source) VALUES($1, 1, 'test_fixture') ON CONFLICT(user_id, policy_version) DO UPDATE SET revoked_at = NULL",
        [user.id],
      );
      people.push({ ...user, username });
    }
    await pool.query("INSERT INTO platform_settings(id,work_hub_enabled) VALUES(1,true) ON CONFLICT(id) DO UPDATE SET work_hub_enabled=true");
    const [host, alpha, bravo] = people;
    const api: APIRequestContext[] = [];
    for (const person of people) {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      await loginAsVendor(page, { username: person.username, password });
      api.push(context.request);
    }
    const [hostApi, alphaApi, bravoApi] = api;
    const envelope = (payload: unknown, expectedVersion: number | null = null) => ({
      operationId: randomUUID(),
      owner: { type: "vendor", id: vendor.id },
      context: { kind: "organization", id: vendor.id },
      expectedVersion,
      payloadVersion: 1,
      payload,
    });
    const status = async (label: string, response: APIResponse, expected: number | number[]) => {
      const allowed = Array.isArray(expected) ? expected : [expected];
      const text = await response.text();
      expect.soft(allowed, `${label}: got ${response.status()} ${text.slice(0, 300)}`).toContain(response.status());
      try { return JSON.parse(text); } catch { return null; }
    };

    const started = await status("host starts live meeting", await hostApi.post("/api/work-hub/live-meetings", {
      data: envelope({ title: `Example live meeting ${stamp}`, admissionMode: "host_approval", participantUserIds: [alpha.id, bravo.id] }),
    }), 200);
    const occurrenceId: string = started?.resource?.meeting?.occurrenceId;
    expect(occurrenceId, "live meeting must be created before the remaining checks").toBeTruthy();
    expect.soft(started.resource.meeting.status).toBe("live");
    const live = `/api/work-hub/live-meetings/${occurrenceId}`;
    const room = `/api/work-hub/meetings/${occurrenceId}`;

    const alphaList = await status("invitee lists live meetings", await alphaApi.get("/api/work-hub/live-meetings"), 200);
    const listed = alphaList?.meetings?.find((m: { occurrenceId: string }) => m.occurrenceId === occurrenceId);
    expect.soft(listed, "invitee sees the live meeting").toBeTruthy();
    expect.soft(listed?.canRequest, "invitee can request admission").toBe(true);
    expect.soft(listed?.canEnter, "invitee cannot enter before admission").toBe(false);

    await status("invitee joining before admission is refused", await alphaApi.post(`${room}/join`, { data: {} }), [403, 404]);
    await status("invitee reading catch-up before admission is refused", await alphaApi.get(`${room}/catch-up`), [403, 404]);

    for (const [label, request] of [["alpha", alphaApi], ["bravo", bravoApi]] as const) {
      const requested = await status(`${label} requests admission`, await request.post(`${live}/request-admission`, { data: envelope({}) }), 200);
      expect.soft(requested?.resource?.admission?.admissionState, `${label} admission is pending`).toBe("pending");
    }

    const lobby = await status("host reads lobby", await hostApi.get(live), 200);
    const requesters = (lobby?.requests ?? []).map((r: { userId: number }) => r.userId);
    expect.soft(requesters, "lobby lists both join requests").toEqual(expect.arrayContaining([alpha.id, bravo.id]));
    const version: number = lobby?.meeting?.version ?? 0;

    const admitted = await status("host admits alpha", await hostApi.post(`${live}/admission/${alpha.id}`, { data: envelope({ decision: "admit" }, version) }), 200);
    expect.soft(admitted?.resource?.admission?.admissionState).toBe("admitted");
    await status("stale lobby version is rejected", await hostApi.post(`${live}/admission/${bravo.id}`, { data: envelope({ decision: "decline" }, version) }), 409);
    await status("attendee cannot decide admission", await alphaApi.post(`${live}/admission/${bravo.id}`, { data: envelope({ decision: "admit" }, version + 1) }), [403, 404]);
    const declined = await status("host declines bravo", await hostApi.post(`${live}/admission/${bravo.id}`, { data: envelope({ decision: "decline" }, version + 1) }), 200);
    expect.soft(declined?.resource?.admission?.admissionState).toBe("declined");
    await status("declined attendee cannot join", await bravoApi.post(`${room}/join`, { data: {} }), [403, 404]);

    for (const [label, request] of [["host", hostApi], ["alpha", alphaApi]] as const) {
      const joined = await status(`${label} joins`, await request.post(`${room}/join`, { data: {} }), 200);
      expect.soft(joined?.authorizationRequired, `${label} can participate`).toBe(false);
      expect.soft(joined?.recordingAllowed, `${label} recording stays off`).toBe(false);
    }

    await status("host posts chat", await hostApi.post(`${room}/chat`, { data: { body: "Host says hello" } }), 200);
    await status("alpha posts chat", await alphaApi.post(`${room}/chat`, { data: { body: "Alpha replies" } }), 200);
    await status("host sends alpha a private message", await hostApi.post(`${room}/chat`, { data: { body: "Private to alpha", recipientUserId: alpha.id } }), 200);
    const alphaView = await status("alpha reads catch-up", await alphaApi.get(`${room}/catch-up`), 200);
    const bodies = (alphaView?.chat ?? []).map((m: { body: string }) => m.body);
    expect.soft(bodies, "alpha sees public and private chat").toEqual(expect.arrayContaining(["Host says hello", "Alpha replies", "Private to alpha"]));

    await status("attendee cannot host-mute the host", await alphaApi.post(`${room}/participants/${host.id}/host-mute`, { data: {} }), 403);
    await status("attendee cannot remove the host", await alphaApi.post(`${room}/participants/${host.id}/remove`, { data: {} }), 403);
    await status("attendee cannot end the meeting", await alphaApi.post(`${room}/end`, { data: {} }), 403);

    await status("request to speak is refused while not host-muted", await alphaApi.post(`${room}/request-to-speak`, { data: { operationId: randomUUID() } }), 409);
    const muted = await status("host mutes alpha", await hostApi.post(`${room}/participants/${alpha.id}/host-mute`, { data: {} }), 200);
    expect.soft(muted?.hostMutedAt, "host mute recorded").toBeTruthy();
    await status("host-muted attendee cannot unmute themselves", await alphaApi.post(`${room}/presence`, { data: { muted: false } }), 409);
    const speakOperation = randomUUID();
    const speak = await status("host-muted attendee requests to speak", await alphaApi.post(`${room}/request-to-speak`, { data: { operationId: speakOperation } }), 200);
    const speakRetry = await status("request to speak retry is idempotent", await alphaApi.post(`${room}/request-to-speak`, { data: { operationId: speakOperation } }), 200);
    expect.soft(speakRetry?.requestId, "retry returns the same request").toBe(speak?.requestId);
    const pending = await status("alpha catch-up shows pending speak request", await alphaApi.get(`${room}/catch-up`), 200);
    expect.soft(pending?.mySpeakRequest?.id, "speak request pending").toBe(speak?.requestId);
    await status("host releases mute", await hostApi.delete(`${room}/participants/${alpha.id}/host-mute`), 200);
    const released = await status("alpha catch-up after release", await alphaApi.get(`${room}/catch-up`), 200);
    expect.soft(released?.mySpeakRequest ?? null, "speak request resolved on release").toBeNull();
    await status("released attendee can unmute", await alphaApi.post(`${room}/presence`, { data: { muted: false } }), 200);

    await status("host removes alpha", await hostApi.post(`${room}/participants/${alpha.id}/remove`, { data: {} }), 200);
    await status("removed attendee loses catch-up", await alphaApi.get(`${room}/catch-up`), [403, 404]);
    await status("removed attendee cannot rejoin", await alphaApi.post(`${room}/join`, { data: {} }), [403, 404]);

    await status("host ends meeting", await hostApi.post(`${room}/end`, { data: {} }), 200);
    const ended = await status("host reads ended meeting", await hostApi.get(`${room}/catch-up`), 200);
    expect.soft(ended?.occurrence?.status).toBe("ended");
    expect.soft((ended?.chat ?? []).map((m: { body: string }) => m.body)).toEqual(expect.arrayContaining(["The host ended the meeting."]));
    await status("joining an ended meeting is refused", await hostApi.post(`${room}/join`, { data: {} }), 409);
    const after = await status("host lists live meetings after end", await hostApi.get("/api/work-hub/live-meetings"), 200);
    expect.soft((after?.meetings ?? []).some((m: { occurrenceId: string }) => m.occurrenceId === occurrenceId), "ended meeting leaves the live list").toBe(false);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await pool.end();
  }
});
