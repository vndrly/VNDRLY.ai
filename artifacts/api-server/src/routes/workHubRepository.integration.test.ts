import { it, expect, vi } from "vitest";
vi.mock("../work-hub/feature-access", () => ({
  isWorkHubEnabled: async () => true,
}));
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable as users,
  vendorsTable as vendors,
  userOrgMembershipsTable as memberships,
  vendorPeopleTable as people,
  workHubFileLibraryTable as records,
} from "@workspace/db";
import { buildTestCookie } from "../test-utils/session";
import router from "./workHubRepository";
import { requireRepositoryDocumentAccess } from "../work-hub/vendor-repository";
import { repositoryCertificationProgress } from '../work-hub/repository-certifications';
import { prepareTrainingProjections } from '../test-utils/training-projections';
it("isolates folders and trips, enforces Assign Travel, deduplicates retries and locks submitted expenses", async () => {
  if (
    process.env.VNDRLY_TEST_DB_MODE !== "fresh-local" ||
    new URL(process.env.DATABASE_URL!).hostname !== "127.0.0.1"
  )
    throw Error("Fresh isolated database required");
  const tag = randomUUID(),
    [vendor] = await db
      .insert(vendors)
      .values({
        name: "Repository synthetic " + tag,
        contactName: "Synthetic",
        contactEmail: tag + "@example.invalid",
      })
      .returning();
  async function person(admin = false, office = false) {
    const [u] = await db
      .insert(users)
      .values({
        username: randomUUID(),
        displayName: "Synthetic",
        passwordHash: "test-only",
        role: "vendor",
      })
      .returning();
    const [p] = await db
      .insert(people)
      .values({
        vendorId: vendor.id,
        userId: u.id,
        firstName: "Synthetic",
        email: randomUUID() + "@example.invalid",
        vendorRole: office ? "office" : "gatekeeper",
      })
      .returning();
    const [m] = await db
      .insert(memberships)
      .values({
        userId: u.id,
        orgType: "vendor",
        vendorId: vendor.id,
        vendorPeopleId: p.id,
        role: admin ? "admin" : "member",
      })
      .returning();
    return {
      id: u.id,
      membershipId: m.id,
      cookie: buildTestCookie({
        userId: u.id,
        sv: u.sessionVersion,
        role: "vendor",
        vendorId: vendor.id,
        activeMembershipId: m.id,
        membershipRole: admin ? "admin" : "member",
      }),
    };
  }
  const admin = await person(true),
    office = await person(false, true),
    worker = await person(),
    other = await person();
  const app = express().use(express.json()).use(cookieParser()).use(router),
    owner = { type: "vendor", id: vendor.id };
  const body = (payload: any, expectedVersion: number | null = null) => ({
    operationId: randomUUID(),
    owner,
    context: { kind: "organization", id: vendor.id },
    payloadVersion: 1,
    expectedVersion,
    payload,
  });
  const post = (who: typeof admin, action: string, command: any) =>
    request(app)
      .post("/work-hub/repository/" + action)
      .set("Cookie", who.cookie)
      .send(command);
  const folder = await post(
    admin,
    "folder",
    body({
      name: "Restricted",
      grants: [{ userIds: [worker.id], read: true, write: false, edit: false }],
    }),
  );
  expect(folder.status, JSON.stringify(folder.body)).toBe(200);
  await prepareTrainingProjections(async () => {
    for (const person of [worker, other]) {
      await repositoryCertificationProgress(db, {type:'vendor',id:vendor.id}, person.id, {membershipId:person.membershipId});
    }
  });
  const visible = await request(app)
    .get("/work-hub/repository")
    .set("Cookie", worker.cookie);
  expect(visible.status, JSON.stringify(visible.body)).toBe(200);
  expect(visible.body.folders.map((f: any) => f.id)).toContain(
    folder.body.resource.id,
  );
  const hidden = await request(app)
    .get("/work-hub/repository")
    .set("Cookie", other.cookie);
  expect(hidden.body.folders).toHaveLength(0);
  const input = {
    title: "Oklahoma to Texas",
    origin: "Oklahoma",
    destination: "Texas gate",
    startDate: "2026-11-02",
    endDate: "2026-11-06",
    purpose: "Assigned gate shift",
    audience: { userIds: [worker.id] },
    mileageRateCents: 70,
  };
  expect((await post(office, "authorize", body(input))).status).toBe(403);
  expect(
    (await post(admin, "travel-grant", body({ userIds: [worker.id] }))).status,
  ).toBe(400);
  const grant = await post(
    admin,
    "travel-grant",
    body({ userIds: [office.id] }),
  );
  expect(grant.status, JSON.stringify(grant.body)).toBe(200);
  const command = body(input),
    authorized = await post(office, "authorize", command);
  expect(authorized.status, JSON.stringify(authorized.body)).toBe(200);
  const retry = await post(office, "authorize", command);
  expect(retry.body.resource.tripIds).toEqual(authorized.body.resource.tripIds);
  const tripId = authorized.body.resource.tripIds[0];
  expect(
    (
      await post(
        other,
        "expense",
        body({
          tripId,
          kind: "mileage",
          date: "2026-11-03",
          description: "Travel",
          distance: 100,
        }),
      )
    ).status,
  ).toBe(404);
  const expense = await post(
    worker,
    "expense",
    body({
      tripId,
      kind: "mileage",
      date: "2026-11-03",
      description: "Travel",
      distance: 100,
    }),
  );
  expect(expense.status, JSON.stringify(expense.body)).toBe(200);
  const [row] = await db
    .select()
    .from(records)
    .where(eq(records.id, expense.body.resource.id));
  expect(row.data.amountCents).toBe(7000);
  expect(
    (await post(worker, "trip-status", body({ tripId, action: "submit" }, 1)))
      .status,
  ).toBe(200);
  expect(
    (
      await post(
        worker,
        "expense",
        body({
          tripId,
          kind: "mileage",
          date: "2026-11-03",
          description: "Locked",
          distance: 1,
        }),
      )
    ).status,
  ).toBe(409);
  expect(
    (await post(worker, "trip-status", body({ tripId, action: "approve" }, 2)))
      .status,
  ).toBe(403);
  expect(
    (await post(office, "trip-status", body({ tripId, action: "approve" }, 2)))
      .status,
  ).toBe(200);
  const [doc] = await db
    .insert(records)
    .values({
      orgType: "vendor",
      orgId: vendor.id,
      kind: "document",
      recordKey: "restricted-material:" + tag,
      createdBy: admin.id,
      data: {
        scope: "company",
        state: "active",
        folderId: folder.body.resource.id,
        currentFileId: randomUUID(),
        version: 1,
      },
    })
    .returning();
  const [aug] = await db
    .insert(records)
    .values({
      orgType: "vendor",
      orgId: vendor.id,
      kind: "vendor_augmentation",
      recordKey: "restricted-assignment:" + tag,
      createdBy: admin.id,
      data: { userIds: [other.id, worker.id], documentIds: [doc.id] },
    })
    .returning();
  expect(
    (
      await post(
        other,
        "ack",
        body({ augmentationId: aug.id, documentId: doc.id, confirmed: true }),
      )
    ).status,
  ).toBe(403);
  const acknowledgement = body({
    augmentationId: aug.id,
    documentId: doc.id,
    confirmed: true,
  });
  expect((await post(worker, "ack", acknowledgement)).status).toBe(200);
  expect(
    (
      await post(
        admin,
        "folder",
        body(
          { id: folder.body.resource.id, name: "Restricted", grants: [] },
          1,
        ),
      )
    ).status,
  ).toBe(200);
  expect((await post(worker, "ack", acknowledgement)).status).toBe(403);
  await post(admin, "travel-grant", body({ userIds: [] }, 1));
  expect((await post(office, "authorize", command)).status).toBe(403);
}, 30000);

it("keeps personal and channel file audiences independent of classification", async () => {
  const actor = { userId: -1 } as any;
  for (const scope of ["personal", "channel"]) {
    await expect(
      requireRepositoryDocumentAccess(
        db,
        actor,
        {
          orgType: "vendor",
          orgId: -1,
          data: { scope, folderId: randomUUID(), tripId: randomUUID() },
        },
        "read",
      ),
    ).resolves.toBeUndefined();
  }
});
