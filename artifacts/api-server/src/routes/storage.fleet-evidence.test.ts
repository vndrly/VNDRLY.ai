import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({
  aclCheck: vi.fn(),
  setAcl: vi.fn(),
  deleteObject: vi.fn(),
}));
vi.mock("../lib/session", () => ({
  getSessionFromRequest: () => ({ userId: 2, role: "field_employee" }),
}));
vi.mock("../lib/objectStorage", () => ({
  ObjectNotFoundError: class extends Error {},
  ObjectStorageService: class {
    async getStoredObject() {
      return {
        contentType: "image/jpeg",
        size: 3,
        body: Buffer.from([255, 216, 255]),
        acl: { owner: "2", visibility: "private", purpose: "fleet-evidence" },
      };
    }
    canAccessStoredObject = boundary.aclCheck;
    normalizeObjectEntityPath(raw: string) {
      return raw;
    }
    trySetObjectEntityAclPolicy = boundary.setAcl;
    deleteStoredObject = boundary.deleteObject;
  },
}));
import storage from "./storage";
const app = express();
app.use(express.json());
app.use(storage);
describe("Fleet evidence owning feature storage boundary", () => {
  it("refuses generic reads even for the original upload owner", async () => {
    expect(
      (await request(app).get("/storage/objects/fleet/7/run/evidence")).status,
    ).toBe(403);
    expect(boundary.aclCheck).not.toHaveBeenCalled();
  });
  it("refuses generic ACL changes and deletion of the immutable Fleet namespace", async () => {
    expect(
      (
        await request(app)
          .post("/storage/uploads/finalize")
          .send({
            objectURL: "/objects/fleet/7/run/evidence",
            visibility: "public",
          })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .delete("/storage/uploads")
          .send({ objectPath: "/objects/fleet/7/run/evidence" })
      ).status,
    ).toBe(400);
    expect(boundary.setAcl).not.toHaveBeenCalled();
    expect(boundary.deleteObject).not.toHaveBeenCalled();
  });
});
