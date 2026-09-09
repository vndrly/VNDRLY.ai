import { randomUUID, createHash } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  db,
  usersTable,
  vendorsTable,
  userOrgMembershipsTable,
  workHubChannelsTable,
  workHubChannelMembersTable,
  workHubFilesTable,
} from "@workspace/db";
import files from "./workHubFileLibrary";
import { buildTestCookie } from "../test-utils/session";
const objects = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("../work-hub/feature-access", () => ({
  isWorkHubEnabled: async () => true,
}));
vi.mock("../lib/objectStorage", async () => {
  const { randomUUID } = await import("node:crypto");
  return {
    ObjectStorageService: class {
      getUploadDescriptor() {
        const id = randomUUID();
        return {
          objectPath: `/objects/uploads/${id}`,
          uploadURL: `/api/storage/upload/${id}`,
        };
      }
      async getStoredObject(path: string) {
        const body = objects.get(path);
        if (!body) throw new Error("Object missing");
        return {
          body,
          size: body.length,
          contentType: "text/plain",
          acl: { visibility: "private" },
        };
      }
      async trySetObjectEntityAclPolicy(path: string) {
        return path;
      }
    },
  };
});
const app = express().use(express.json()).use(cookieParser()).use(files);
describe.skipIf(process.env.VNDRLY_TEST_DB_MODE !== "fresh-local")(
  "managed private file library",
  () => {
    let ownerId: number,
      adminId: number,
      memberId: number,
      admin: string,
      member: string,
      external: string,
      privateChannel: string,
      externalId: number,
      externalOrg: number;
    const envelope = <T>(payload: T, operationId: string = randomUUID()) => ({
      owner: { type: "vendor", id: ownerId },
      context: { kind: "organization", id: ownerId },
      payloadVersion: 1,
      expectedVersion: null,
      operationId,
      payload,
    });
    const post = (action: string, cookie: string, payload: unknown) =>
      request(app)
        .post(`/work-hub/file-library/${action}`)
        .set("Cookie", cookie)
        .send(envelope(payload));
    const draft = (scope: string, body = "file contents", extra = {}) => ({
      scope,
      fileName: "notes.txt",
      contentType: "text/plain",
      byteSize: Buffer.byteLength(body),
      checksumSha256: createHash("sha256").update(body).digest("hex"),
      ...extra,
    });
    async function upload(
      scope: string,
      cookie: string,
      body = "file contents",
      extra = {},
    ) {
      const reserved = await post("reserve", cookie, draft(scope, body, extra));
      expect(reserved.status).toBe(201);
      const resource = reserved.body.resource;
      objects.set(resource.objectPath, Buffer.from(body));
      const finalized = await post("finalize", cookie, {
        id: resource.documentId,
        fileId: resource.fileId,
      });
      expect(finalized.status).toBe(201);
      return resource;
    }
    beforeAll(async () => {
      const suffix = randomUUID();
      const companies = await db
        .insert(vendorsTable)
        .values(
          ["A", "B"].map((n) => ({
            name: `Files ${n} ${suffix}`,
            contactName: "Test",
            contactEmail: `${n}.${suffix}@example.invalid`,
          })),
        )
        .returning();
      ownerId = companies[0]!.id;
      externalOrg = companies[1]!.id;
      const people = await db
        .insert(usersTable)
        .values(
          ["Admin", "Member", "External"].map((n) => ({
            username: `${n}.${suffix}`,
            displayName: n,
            passwordHash: "unused-test-hash",
            role: "vendor",
          })),
        )
        .returning();
      [adminId, memberId] = people.map((p) => p.id) as [number, number];
      externalId = people[2]!.id;
      await db.insert(userOrgMembershipsTable).values([
        {
          userId: adminId,
          orgType: "vendor",
          vendorId: ownerId,
          role: "admin",
        },
        {
          userId: memberId,
          orgType: "vendor",
          vendorId: ownerId,
          role: "member",
        },
        {
          userId: people[2]!.id,
          orgType: "vendor",
          vendorId: companies[1]!.id,
          role: "admin",
        },
      ]);
      admin = buildTestCookie({
        userId: adminId,
        role: "vendor",
        vendorId: ownerId,
        membershipRole: "admin",
      });
      member = buildTestCookie({
        userId: memberId,
        role: "vendor",
        vendorId: ownerId,
        membershipRole: "member",
      });
      external = buildTestCookie({
        userId: people[2]!.id,
        role: "vendor",
        vendorId: companies[1]!.id,
        membershipRole: "admin",
      });
      const [channel] = await db
        .insert(workHubChannelsTable)
        .values({
          ownerOrgType: "vendor",
          ownerOrgId: ownerId,
          contextKind: "organization",
          contextId: randomUUID(),
          name: "Private files",
          visibility: "private",
          createdById: memberId,
        })
        .returning();
      privateChannel = channel!.id;
      await db
        .insert(workHubChannelMembersTable)
        .values({ channelId: privateChannel, userId: memberId, mode: "owner" });
    });
    it("personal files are invisible to other members including company administrators", async () => {
      const personal = await upload("personal", member);
      expect(
        (
          await request(app)
            .get(`/work-hub/file-library/${personal.documentId}/download`)
            .set("Cookie", admin)
        ).status,
      ).toBe(404);
      expect(
        (
          await request(app)
            .get(`/work-hub/file-library/${personal.documentId}/download`)
            .set("Cookie", external)
        ).status,
      ).toBe(404);
      const list = await request(app)
        .get(`/work-hub/file-library?orgType=vendor&orgId=${ownerId}`)
        .set("Cookie", admin);
      expect(list.body.some((row: any) => row.id === personal.documentId)).toBe(
        false,
      );
      expect(
        (
          await request(app)
            .get(`/work-hub/file-library/${personal.documentId}/download`)
            .set("Cookie", member)
        ).status,
      ).toBe(200);
    });
    it("company files enforce tenant ownership; reserve replay produces one version", async () => {
      expect((await post("reserve", external, draft("company"))).status).toBe(
        403,
      );
      const body = envelope(draft("company"));
      const first = await request(app)
        .post("/work-hub/file-library/reserve")
        .set("Cookie", admin)
        .send(body);
      const replay = await request(app)
        .post("/work-hub/file-library/reserve")
        .set("Cookie", admin)
        .send(body);
      expect(replay.body.resource.fileId).toBe(first.body.resource.fileId);
      expect(replay.body.replayed).toBe(true);
      objects.set(first.body.resource.objectPath, Buffer.from("changed bytes"));
      expect(
        (
          await post("finalize", admin, {
            id: first.body.resource.documentId,
            fileId: first.body.resource.fileId,
          })
        ).status,
      ).toBe(409);
    });
    it("preserves prior versions and isolates favorites by user", async () => {
      const first = await upload("company", admin, "first");
      const second = await upload("company", admin, "second", {
        documentId: first.documentId,
      });
      expect(second.documentId).toBe(first.documentId);
      const old = await request(app)
        .get(
          `/work-hub/file-library/${first.documentId}/download?version=${first.fileId}`,
        )
        .set("Cookie", member);
      expect(old.text).toBe("first");
      const current = await request(app)
        .get(`/work-hub/file-library/${first.documentId}/download`)
        .set("Cookie", member);
      expect(current.text).toBe("second");
      await post("favorite", member, { id: first.documentId, active: true });
      const mine = await request(app)
        .get(`/work-hub/file-library?orgType=vendor&orgId=${ownerId}`)
        .set("Cookie", member);
      expect(
        mine.body.find((row: any) => row.id === first.documentId).favorite,
      ).toBe(true);
      const theirs = await request(app)
        .get(`/work-hub/file-library?orgType=vendor&orgId=${ownerId}`)
        .set("Cookie", admin);
      expect(
        theirs.body.find((row: any) => row.id === first.documentId).favorite,
      ).toBe(false);
      objects.set(second.objectPath, Buffer.from("tamper"));
      expect(
        (
          await request(app)
            .get(`/work-hub/file-library/${first.documentId}/download`)
            .set("Cookie", admin)
        ).status,
      ).toBe(409);
    });
    it("limits sharing/recycling to owner or administrator and revokes links", async () => {
      const doc = await upload("company", admin);
      expect((await post("share", member, { id: doc.documentId })).status).toBe(
        403,
      );
      const shared = await post("share", admin, {
        id: doc.documentId,
        expiresInDays: 1,
      });
      const path = `/work-hub/file-library/public/${shared.body.resource.token}`;
      const publicFile = await request(app).get(path);
      expect(publicFile.status).toBe(200);
      expect(publicFile.headers["content-disposition"]).toContain("attachment");
      expect(publicFile.headers["content-security-policy"]).toContain(
        "sandbox",
      );
      await post("recycle", admin, { id: doc.documentId });
      expect((await request(app).get(path)).status).toBe(404);
      await post("restore", admin, { id: doc.documentId });
      await post("revoke-share", admin, { id: doc.documentId });
      expect((await request(app).get(path)).status).toBe(404);
    });
    it("requires channel access and matching channel ownership", async () => {
      const doc = await upload("channel", member, "private channel content", {
        channelId: privateChannel,
      });
      expect(
        (
          await request(app)
            .get(`/work-hub/file-library/${doc.documentId}/download`)
            .set("Cookie", external)
        ).status,
      ).toBe(404);
      expect(
        (
          await post(
            "reserve",
            external,
            draft("channel", "x", { channelId: privateChannel }),
          )
        ).status,
      ).toBe(404);
      await db.insert(workHubChannelMembersTable).values({
        channelId: privateChannel,
        userId: externalId,
        mode: "member",
      });
      const sharedListing = await request(app)
        .get(`/work-hub/file-library?orgType=vendor&orgId=${externalOrg}`)
        .set("Cookie", external);
      expect(
        sharedListing.body.some((row: any) => row.id === doc.documentId),
      ).toBe(true);
      const invited = await upload(
        "channel",
        external,
        "invited contribution",
        { channelId: privateChannel },
      );
      expect(
        (
          await request(app)
            .get(`/work-hub/file-library/${invited.documentId}/download`)
            .set("Cookie", member)
        ).status,
      ).toBe(200);
    });
    it("retains existing uploads without exposing foreign tenant files or object keys", async () => {
      const path = "/objects/uploads/" + randomUUID();
      objects.set(path, Buffer.from("legacy"));
      const [legacy] = await db
        .insert(workHubFilesTable)
        .values({
          ownerOrgType: "vendor",
          ownerOrgId: ownerId,
          uploadedById: adminId,
          storageKey: path,
          fileName: "older.txt",
          contentType: "text/plain",
          byteSize: 6,
          checksumSha256: createHash("sha256").update("legacy").digest("hex"),
          state: "finalized",
          finalizedAt: new Date(),
        })
        .returning();
      const list = await request(app)
        .get("/work-hub/file-library/legacy")
        .set("Cookie", member);
      const row = list.body.find((row: any) => row.id === legacy!.id);
      expect(row.fileName).toBe("older.txt");
      expect(row.storageKey).toBeUndefined();
      const denied = await request(app)
        .get("/work-hub/file-library/legacy")
        .set("Cookie", external);
      expect(denied.body.some((row: any) => row.id === legacy!.id)).toBe(false);
      expect(
        (
          await request(app)
            .get("/work-hub/file-library/legacy/" + legacy!.id + "/download")
            .set("Cookie", member)
        ).text,
      ).toBe("legacy");
    });
    it("rechecks current company authorization before replaying cached operations", async () => {
      const file = await upload("company", admin);
      const body = envelope({ id: file.documentId, active: true });
      expect(
        (
          await request(app)
            .post("/work-hub/file-library/favorite")
            .set("Cookie", member)
            .send(body)
        ).status,
      ).toBe(201);
      await db
        .delete(userOrgMembershipsTable)
        .where(
          and(
            eq(userOrgMembershipsTable.userId, memberId),
            eq(userOrgMembershipsTable.vendorId, ownerId),
          ),
        );
      expect(
        (
          await request(app)
            .post("/work-hub/file-library/favorite")
            .set("Cookie", member)
            .send(body)
        ).status,
      ).toBe(404);
    });
  },
);
