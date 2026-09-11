import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  session: { userId: 1, vendorId: 22, partnerId: null, role: "vendor" } as {
    userId: number;
    vendorId: number | null;
    partnerId: number | null;
    role: string;
  } | null,
  results: [] as unknown[][],
  predicates: [] as SQL[],
}));

vi.mock("../lib/session", () => ({ getSessionFromRequest: () => mocks.session }));
vi.mock("../work-hub/audit", () => ({ appendWorkHubAudit: vi.fn() }));
vi.mock("../lib/objectStore", () => ({ getObjectStore: () => ({}) }));
vi.mock("../work-hub/native-transcription", () => ({
  nativeTranscriptionAvailable: () => false,
  transcribeNativeAudio: vi.fn(),
}));

vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual("@workspace/db/schema");
  function chain() {
    const query: Record<string, unknown> = {};
    for (const method of ["from", "where", "for", "orderBy", "limit"]) {
      query[method] = (value: unknown) => {
        if (method === "where") mocks.predicates.push(value as SQL);
        return query;
      };
    }
    query.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(mocks.results.shift() ?? []).then(resolve);
    return query;
  }
  const tx = { select: () => chain() };
  return {
    ...schema,
    db: {
      ...tx,
      transaction: (fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});

import router from "./workHubMeetings";

const occurrenceId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea01";
const attendees = [
  { id: "host", userId: 1, role: "host", removedAt: null, muted: false, handRaisedAt: null },
  { id: "guest", userId: 2, role: "participant", removedAt: null, muted: true, handRaisedAt: null },
  { id: "missing", userId: 3, role: "participant", removedAt: null, muted: true, handRaisedAt: null },
];

function application() {
  const application = express();
  application.use("/meetings", router);
  application.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: "Transaction failed" });
  });
  return application;
}

function seedContext() {
  mocks.results.push(
    [{ id: occurrenceId, meetingId: occurrenceId, status: "live", recordingState: "off", askvInvitedAt: null, runtime: {} }],
    [{ id: occurrenceId, ownerOrgType: "vendor", ownerOrgId: 22, policyVersion: 1, recordingAllowed: false }],
    attendees,
  );
}

function seedCatchUpReads() {
  mocks.results.push(
    attendees.map((attendee) => ({ id: attendee.userId, displayName: `User ${attendee.userId}` })),
    [],
    [],
    [],
    [],
    [],
  );
}

beforeEach(() => {
  mocks.session = { userId: 1, vendorId: 22, partnerId: null, role: "vendor" };
  mocks.results = [];
  mocks.predicates = [];
});

describe("meeting catch-up participant photos", () => {
  it("returns only owner-vendor attendee photos using canonical source precedence", async () => {
    seedContext();
    seedCatchUpReads();
    mocks.results.push([
      { userId: 1, vendorId: 22, isActive: true, deletedAt: null, profilePhotoPath: "/objects/uploads/host", photoUrl: "https://legacy.example/host.jpg" },
      { userId: 2, vendorId: 22, isActive: true, deletedAt: null, profilePhotoPath: null, photoUrl: "https://legacy.example/guest.jpg" },
      { userId: 99, vendorId: 22, isActive: true, deletedAt: null, profilePhotoPath: "/objects/uploads/unrelated", photoUrl: null },
    ]);

    const response = await request(application()).get(`/meetings/${occurrenceId}/catch-up`);

    expect(response.status).toBe(200);
    expect(response.body.participants.map((participant: { userId: number; photoUrl: string | null }) => ({
      userId: participant.userId,
      photoUrl: participant.photoUrl,
    }))).toEqual([
      { userId: 1, photoUrl: "/api/storage/objects/uploads/host" },
      { userId: 2, photoUrl: "https://legacy.example/guest.jpg" },
      { userId: 3, photoUrl: null },
    ]);

    const photoQuery = mocks.predicates
      .map((predicate) => new PgDialect().sqlToQuery(predicate))
      .find((query) => query.sql.includes('"vendor_people"."vendor_id"'));
    expect(photoQuery?.sql).toContain('"vendor_people"."user_id" in');
    expect(photoQuery?.sql).toContain('"vendor_people"."is_active"');
    expect(photoQuery?.sql).toContain('"vendor_people"."deleted_at" is null');
    expect(photoQuery?.params).toEqual([22, 1, 2, 3, true]);
  });

  it("returns null photos and performs no profile lookup for an accepted external call attendee", async () => {
    seedContext();
    mocks.session = { userId: 1, vendorId: 77, partnerId: null, role: "vendor" };
    mocks.results.push([{ occurrenceId, status: "active", answeredAt: new Date(), callerUserId: 2, recipientUserId: 1 }]);
    seedCatchUpReads();

    const response = await request(application()).get(`/meetings/${occurrenceId}/catch-up`);

    expect(response.status).toBe(200);
    expect(response.body.participants.map((participant: { photoUrl: string | null }) => participant.photoUrl)).toEqual([null, null, null]);
    const queries = mocks.predicates.map((predicate) => new PgDialect().sqlToQuery(predicate));
    expect(queries.some((query) => query.sql.includes('"vendor_people"."vendor_id"'))).toBe(false);
  });
});
