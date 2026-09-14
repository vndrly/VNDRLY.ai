import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createPool, makeStamp } from "../helpers/db";
import { loginAsVendor } from "../helpers/auth";
import { createPartner, createSiteLocation } from "../helpers/fixtures";
import {
  createVendorActor,
  createVendorMember,
} from "../helpers/implementation-a";

test("manual crash reporting persists and escalates even when live services are degraded", async ({
  page,
}) => {
  const pool = createPool();
  const stamp = makeStamp();
  const admin = await createVendorActor(pool, "Safety Sponsor");
  try {
    const partner = await createPartner(pool, {
      name: `Safety Site Owner ${stamp}`,
      contactName: "Safety Owner",
      contactEmail: `safety-site-${stamp}@example.invalid`,
    });
    const site = await createSiteLocation(pool, {
      partnerId: partner.id,
      name: `Safety Site ${stamp}`,
      address: "200 Example Safety Road, Texas",
      latitude: 31,
      longitude: -98,
      siteCode: `SAFE-${stamp.slice(-8).toUpperCase()}`,
      siteRadiusMeters: 250,
    });
    const event = await pool.query<{ id: number }>(
      `INSERT INTO safety_events
       (event_number,event_type,status,title,description,site_location_id,partner_id,vendor_id,reported_by_user_id)
       VALUES ($1,'vehicle_incident','submitted',$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [
        `EVT-${stamp}`,
        "Vehicle incident",
        "Driver reported being struck",
        site.id,
        partner.id,
        admin.vendorId,
        admin.userId,
      ],
    );
    await loginAsVendor(page, admin);
    const incident = await page.request.post(
      "/api/implementation-a/safety/incidents",
      {
        data: {
          organizationId: admin.vendorId,
          safetyEventId: event.rows[0].id,
          source: "manual",
          severity: "high",
          originalReport:
            "I was struck by another vehicle and need the safety chain notified.",
          degradedCapabilities: ["askv", "mapbox", "push"],
        },
      },
    );
    expect(incident.status()).toBe(201);
    const created = await incident.json();
    expect(created).toMatchObject({
      persisted: true,
      responseStatus: "open",
      configurationWarning: "missing_safety_chain",
    });
    expect(created.degradedCapabilities).toEqual(
      expect.arrayContaining(["askv", "mapbox", "push"]),
    );

    const acknowledgement = await page.request.post(
      `/api/implementation-a/safety/incidents/${event.rows[0].id}/acknowledge`,
    );
    expect(acknowledgement.status()).toBe(200);
    expect(await acknowledgement.json()).toMatchObject({
      responseStatus: "acknowledged",
      acknowledgedByUserId: admin.userId,
    });
    const close = await page.request.post(
      `/api/implementation-a/safety/incidents/${event.rows[0].id}/close`,
      {
        data: {
          resolution:
            "Responder reached the driver and preserved the original report.",
        },
      },
    );
    expect(close.status()).toBe(200);
    expect(await close.json()).toMatchObject({
      responseStatus: "closed",
      closedByUserId: admin.userId,
    });
    const evidence = await pool.query(
      "SELECT value FROM safety_incident_evidence WHERE response_id=$1 ORDER BY created_at",
      [created.id],
    );
    expect(evidence.rows.at(-1)?.value).toContain(
      "preserved the original report",
    );
  } finally {
    await pool.end();
  }
});

test("a view-only call participant accepts once in place and immediately becomes active", async ({
  browser,
  page,
}) => {
  const pool = createPool();
  const host = await createVendorActor(pool, "Meeting Sponsor");
  const participant = await createVendorMember(
    pool,
    host.vendorId,
    "Meeting Participant",
  );
  const participantContext = await browser.newContext();
  try {
    await loginAsVendor(page, host);
    const participantPage = await participantContext.newPage();
    await loginAsVendor(participantPage, participant);
    const callResponse = await page.request.post("/api/work-hub/calls", {
      data: { recipientUserId: participant.userId, operationId: randomUUID() },
    });
    expect(callResponse.status()).toBe(201);
    const call = await callResponse.json();
    const accepted = await participantPage.request.post(
      `/api/work-hub/calls/${call.id}/respond`,
      {
        data: { action: "accept" },
      },
    );
    expect(accepted.status()).toBe(200);

    const viewOnlyResponse = await participantPage.request.post(
      `/api/work-hub/meetings/${call.occurrenceId}/join`,
      { data: {} },
    );
    expect(viewOnlyResponse.status()).toBe(200);
    const viewOnly = await viewOnlyResponse.json();
    expect(viewOnly).toMatchObject({
      participationMode: "view_only",
      authorizationRequired: true,
      consentAccepted: false,
      roomId: null,
    });
    const authorization = await participantPage.request.post(
      `/api/work-hub/meetings/${call.occurrenceId}/consent`,
      { data: { policyVersion: viewOnly.policyVersion, response: "accepted" } },
    );
    expect(authorization.status()).toBe(200);
    expect(await authorization.json()).toMatchObject({
      participationMode: "active",
      rejoinRequired: false,
    });
    const activeResponse = await participantPage.request.post(
      `/api/work-hub/meetings/${call.occurrenceId}/join`,
      { data: {} },
    );
    expect(activeResponse.status()).toBe(200);
    expect(await activeResponse.json()).toMatchObject({
      participationMode: "active",
      authorizationRequired: false,
      consentAccepted: true,
      roomId: expect.any(String),
    });
  } finally {
    await participantContext.close();
    await pool.end();
  }
});
