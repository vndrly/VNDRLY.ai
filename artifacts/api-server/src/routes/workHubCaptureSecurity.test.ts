import { randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  db,
  usersTable,
  vendorsTable,
  workHubMeetingsTable,
  workHubMeetingOccurrencesTable,
  workHubMeetingParticipantsTable,
  workHubFilesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import operations from "./workHubOperations";
import storage from "./storage";
import { buildTestCookie } from "../test-utils/session";
const state = vi.hoisted(() => ({
  acl: null as { owner: string; visibility: string } | null,
  setAcl: vi.fn(),
  putObject: vi.fn(),
  deleteObject: vi.fn(),
}));
vi.mock("../work-hub/feature-access", () => ({
  isWorkHubEnabled: async () => true,
}));
vi.mock("../lib/objectStorage", () => ({
  ObjectNotFoundError: class extends Error {},
  ObjectStorageService: class {
    normalizeObjectEntityPath(path: string) {
      return path;
    }
    async getStoredObject() {
      return {
        acl: state.acl,
        body: Buffer.from("file"),
        contentType: "text/plain",
        size: 4,
      };
    }
    async deleteStoredObject(path: string) {
      state.deleteObject(path);
    }
    async getStoredObjectAcl() {
      return state.acl;
    }
    async trySetObjectEntityAclPolicy(path: string, acl: unknown) {
      state.setAcl(path, acl);
      return path;
    }
  },
}));
vi.mock("../lib/objectStore", () => ({
  UPLOAD_ROUTE: "/storage/upload/:id",
  getObjectStore: () => ({ putObject: state.putObject }),
}));
const app = express()
  .use(express.json())
  .use(cookieParser())
  .use(operations)
  .use(storage);
describe.skipIf(process.env.VNDRLY_TEST_DB_MODE !== "fresh-local")(
  "capture and storage security boundaries",
  () => {
    let orgId: number,
      hostId: number,
      guestId: number,
      host: string,
      guest: string,
      occurrenceId: string,
      managedPath: string;
    const post = (route: string, cookie: string, body: unknown) =>
      request(app)
        .post(`/work-hub/meetings/${occurrenceId}/${route}`)
        .set("Cookie", cookie)
        .send(body as Record<string, unknown>);
    beforeAll(async () => {
      const suffix = randomUUID();
      const [vendor] = await db
        .insert(vendorsTable)
        .values({
          name: `Capture ${suffix}`,
          contactName: "Test",
          contactEmail: `${suffix}@example.invalid`,
        })
        .returning();
      orgId = vendor!.id;
      const people = await db
        .insert(usersTable)
        .values(
          ["Host", "Guest"].map((name) => ({
            username: `${name}.${suffix}`,
            displayName: name,
            passwordHash: "unused-test-hash",
            role: "vendor",
          })),
        )
        .returning();
      hostId = people[0]!.id;
      guestId = people[1]!.id;
      host = buildTestCookie({
        userId: hostId,
        role: "vendor",
        vendorId: orgId,
        membershipRole: "admin",
      });
      guest = buildTestCookie({
        userId: guestId,
        role: "vendor",
        vendorId: orgId,
        membershipRole: "member",
      });
      const [meeting] = await db
        .insert(workHubMeetingsTable)
        .values({
          ownerOrgType: "vendor",
          ownerOrgId: orgId,
          title: "Capture test",
          timezone: "UTC",
          recordingAllowed: true,
          createdById: hostId,
        })
        .returning();
      const [occurrence] = await db
        .insert(workHubMeetingOccurrencesTable)
        .values({ meetingId: meeting!.id, startsAt: new Date() })
        .returning();
      occurrenceId = occurrence!.id;
      await db.insert(workHubMeetingParticipantsTable).values([
        { occurrenceId, userId: hostId, role: "host" },
        { occurrenceId, userId: guestId, role: "participant" },
      ]);
      managedPath = `/objects/uploads/${randomUUID()}`;
      await db.insert(workHubFilesTable).values({
        ownerOrgType: "vendor",
        ownerOrgId: orgId,
        uploadedById: hostId,
        storageKey: managedPath,
        fileName: "private.txt",
        contentType: "text/plain",
        byteSize: 4,
        checksumSha256: "a".repeat(64),
        state: "managed",
      });
    });
    beforeEach(() => {
      state.acl = null;
      state.setAcl.mockClear();
      state.deleteObject.mockClear();
      state.putObject.mockClear();
    });
    it("forbids generic ACL changes to managed namespaces, registered files and another owner", async () => {
      const finalize = (path: string) =>
        request(app)
          .post("/storage/uploads/finalize")
          .set("Cookie", host)
          .send({ objectURL: path, visibility: "public" });
      expect(
        (await finalize(`/objects/work-hub-recordings/${occurrenceId}/audio`))
          .status,
      ).toBe(403);
      expect((await finalize(managedPath)).status).toBe(403);
      state.acl = { owner: String(guestId), visibility: "private" };
      expect((await finalize(`/objects/uploads/${randomUUID()}`)).status).toBe(
        403,
      );
      expect(state.setAcl).not.toHaveBeenCalled();
      state.acl = { owner: String(hostId), visibility: "private" };
      expect((await finalize(`/objects/uploads/${randomUUID()}`)).status).toBe(
        200,
      );
      expect(state.setAcl).toHaveBeenCalledTimes(1);
    });
    it("requires present host and all current consents; concurrent decline leaves capture off", async () => {
      expect((await post("recording", host, { enabled: true })).status).toBe(
        409,
      );
      await post("join", host, {});
      await post("join", guest, {});
      expect((await post("recording", guest, { enabled: true })).status).toBe(
        403,
      );
      await post("consent", host, { policyVersion: 1, response: "accepted" });
      expect((await post("recording", host, { enabled: true })).status).toBe(
        409,
      );
      await post("consent", guest, { policyVersion: 1, response: "accepted" });
      await Promise.all([
        post("recording", host, { enabled: true }),
        post("consent", guest, { policyVersion: 1, response: "declined" }),
      ]);
      const [entry] = await db
        .select()
        .from(workHubMeetingOccurrencesTable)
        .where(eq(workHubMeetingOccurrencesTable.id, occurrenceId));
      expect(entry!.recordingState).toBe("off");
      expect(
        (
          await post("consent", guest, {
            policyVersion: 2,
            response: "accepted",
          })
        ).status,
      ).toBe(409);
    });
    it("checks host and consent on upload, prevents replacement, and ties transcripts to authorized audio", async () => {
      const chunk = {
        id: randomUUID(),
        audioBase64: Buffer.from("recording").toString("base64"),
        contentType: "audio/webm",
        startsAtMs: 0,
        endsAtMs: 1000,
      };
      expect((await post("audio-chunks", guest, chunk)).status).toBe(403);
      expect((await post("audio-chunks", host, chunk)).status).toBe(409);
      await post("consent", guest, { policyVersion: 1, response: "accepted" });
      expect((await post("recording", host, { enabled: true })).status).toBe(
        200,
      );
      expect((await post("audio-chunks", host, chunk)).status).toBe(200);
      expect(state.putObject).toHaveBeenCalledTimes(1);
      expect((await post("audio-chunks", host, chunk)).body.replayed).toBe(
        true,
      );
      expect(state.putObject).toHaveBeenCalledTimes(1);
      expect(
        (
          await post("audio-chunks", host, {
            ...chunk,
            audioBase64: Buffer.from("changed").toString("base64"),
          })
        ).status,
      ).toBe(409);
      await post("recording", host, { enabled: false });
      const transcript = {
        id: chunk.id,
        text: "Recorded words",
        startsAtMs: 0,
        endsAtMs: 1000,
      };
      expect((await post("transcript", guest, transcript)).status).toBe(403);
      const first = await post("transcript", host, transcript);
      expect(first.status).toBe(200);
      expect(first.body.speakerUserId).toBeNull();
      expect((await post("transcript", host, transcript)).body.id).toBe(
        first.body.id,
      );
      expect(
        (await post("transcript", host, { ...transcript, id: randomUUID() }))
          .status,
      ).toBe(409);
      expect(
        (await post("transcript", host, { ...transcript, text: "Changed" }))
          .status,
      ).toBe(409);
    });
    it("duplicate joins preserve consent while new attendance requires fresh consent", async () => {
      expect((await post("recording", host, { enabled: true })).status).toBe(
        200,
      );
      const duplicate = await post("join", guest, {});
      expect(duplicate.body.consentAccepted).toBe(true);
      expect(
        (
          await request(app)
            .get(`/work-hub/meetings/${occurrenceId}/audio-state`)
            .set("Cookie", host)
        ).body.recordingState,
      ).toBe("active");
      await post("leave", guest, {});
      const rejoined = await post("join", guest, {});
      expect(rejoined.body.consentAccepted).toBe(false);
      expect((await post("recording", host, { enabled: true })).status).toBe(
        409,
      );
      await post("consent", guest, { policyVersion: 1, response: "accepted" });
      expect((await post("recording", host, { enabled: true })).status).toBe(
        200,
      );
      await post("leave", host, {});
      expect((await post("recording", host, { enabled: true })).status).toBe(
        409,
      );
    });
    it("generic deletion preserves registered Work Hub uploads even for the uploader", async () => {
      state.acl = { owner: String(hostId), visibility: "private" };
      expect(
        (
          await request(app)
            .delete("/storage/uploads")
            .set("Cookie", host)
            .send({ objectPath: managedPath })
        ).status,
      ).toBe(409);
      expect(state.deleteObject).not.toHaveBeenCalled();
    });
  },
);
