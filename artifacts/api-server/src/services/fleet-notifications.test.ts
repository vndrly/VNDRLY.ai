import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PoolClient } from "pg";
import { FleetRunSchema } from "@workspace/api-zod";
import { emptyFleetState } from "./fleet-repository";
const send = vi.hoisted(() => vi.fn());
vi.mock("../routes/notifications", () => ({ notifyUsers: send }));
import {
  fleetRunNotificationRecipients,
  emitFleetRunNotification,
} from "./fleet-notifications";
beforeEach(() => {
  send.mockReset().mockResolvedValue(1);
});
it("filters current company memberships, exact Fleet/site roles and own assignment before notification", async () => {
  const run = FleetRunSchema.parse({
    id: randomUUID(),
    companyId: 7,
    fleetId: randomUUID(),
    title: "Private title",
    driverUserId: 2,
    vehicleAssetId: randomUUID(),
    trailerAssetId: null,
    siteIds: [9],
    status: "dispatched",
    phase: null,
    version: 2,
    stops: [{ id: randomUUID(), siteId: 9, kind: "pickup", sequence: 0 }],
    loads: [],
    records: [],
    inspections: [],
    currentStopId: null,
    visitedStopIds: [],
    events: [],
    linkedTicketId: null,
    allowedActions: [],
  });
  const state = {
    ...emptyFleetState(),
    enabled: true,
    grants: [1, 2, 3, 4, 5].map((userId) => ({
      userId,
      fleetIds: [userId === 4 ? randomUUID() : run.fleetId],
      siteIds: [userId === 5 ? 10 : 9],
      roles: [userId === 1 ? "fleet_manager" : "driver"] as (
        | "fleet_manager"
        | "driver"
      )[],
      safetyRelease: false,
      financeRead: false,
    })),
  };
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ id: 9 }] })
    .mockResolvedValueOnce({
      rows: [{ user_id: 1 }, { user_id: 2 }, { user_id: 99 }],
    });
  const notice = await fleetRunNotificationRecipients(
    state,
    { query } as unknown as PoolClient,
    run,
    "dispatch",
    randomUUID(),
    1,
  );
  expect(query.mock.calls[1][1]).toEqual([7, [2]]);
  expect(notice?.userIds).toEqual([2]);
  await emitFleetRunNotification(notice!);
  await emitFleetRunNotification(notice!);
  expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
  expect(send.mock.calls[0][1]).toMatchObject({
    type: "fleet_run_event",
    category: "crew",
    link: `/fleet/runs/${run.id}`,
    dedupeKey: `fleet:7:${notice!.operationId}`,
  });
  expect(JSON.stringify(send.mock.calls)).not.toContain("Private title");
  query.mockResolvedValue({ rows: [] });
  expect(
    await fleetRunNotificationRecipients(
      state,
      { query } as unknown as PoolClient,
      run,
      "dispatch",
      randomUUID(),
      1,
    ),
  ).toBeUndefined();
});
it("never turns delivery failure into a false success or domain rollback", async () => {
  send.mockRejectedValue(new Error("Provider unavailable"));
  expect(
    await emitFleetRunNotification({
      userIds: [2],
      runId: randomUUID(),
      companyId: 7,
      operationId: randomUUID(),
      action: "dispatch",
      title: "Fleet run dispatched",
    }),
  ).toBe(0);
});
