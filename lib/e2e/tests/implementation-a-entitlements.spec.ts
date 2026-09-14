import { test, expect } from "@playwright/test";
import { createPool, makeStamp } from "../helpers/db";
import { loginAsVendor } from "../helpers/auth";
import {
  createVendorActor,
  expectNoSecretFields,
} from "../helpers/implementation-a";

test("company-sponsored worker seats pause without losing identity or history", async ({
  page,
}) => {
  const pool = createPool();
  const stamp = makeStamp();
  const sponsor = await createVendorActor(pool, "Seat Sponsor");
  try {
    await loginAsVendor(page, sponsor);
    const managed = await page.request.post(
      "/api/implementation-a/managed-organizations",
      {
        data: { name: `Managed Crew ${stamp}` },
      },
    );
    expect(managed.status()).toBe(201);
    const managedOrganizationId = (await managed.json()).id;
    const activated = await page.request.post(
      "/api/implementation-a/subscriptions",
      {
        data: {
          email: `seat-${stamp}@example.invalid`,
          displayName: "Paused Worker",
          managedOrganizationId,
          authorizationVersion: "work-participation-2026-09",
          plan: "gate_only",
          monthlyPriceCents: 999,
          renewalAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          previewAccess: true,
          confirmed: true,
        },
      },
    );
    expect(activated.status()).toBe(201);
    const activation = await activated.json();
    expectNoSecretFields(activation);
    const seatId = activation.seat.id as string;
    const workerUserId = activation.seat.workerUserId as number;

    const paused = await page.request.post(
      `/api/implementation-a/subscriptions/${seatId}/pause`,
    );
    expect(paused.status()).toBe(200);
    expect(await paused.json()).toMatchObject({
      status: "applied",
      seat: { state: "paused", renews: false },
    });
    const retained = await pool.query(
      `SELECT u.id, ws.state, m.status
       FROM users u
       JOIN worker_subscriptions ws ON ws.worker_user_id=u.id
       JOIN managed_subcontractor_worker_sponsorships m ON m.worker_user_id=u.id
       WHERE u.id=$1 AND ws.id=$2`,
      [workerUserId, seatId],
    );
    expect(retained.rows[0]).toMatchObject({
      id: workerUserId,
      state: "paused",
      status: "paused",
    });

    const renewalAt = new Date(Date.now() + 60 * 86_400_000).toISOString();
    const reactivated = await page.request.post(
      `/api/implementation-a/subscriptions/${seatId}/reactivate`,
      {
        data: { renewalAt, confirmed: true },
      },
    );
    expect(reactivated.status()).toBe(200);
    expect(await reactivated.json()).toMatchObject({
      status: "applied",
      seat: { state: "active", workerUserId },
    });
  } finally {
    await pool.end();
  }
});
