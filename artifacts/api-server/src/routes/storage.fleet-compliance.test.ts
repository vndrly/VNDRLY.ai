import express from "express";
import request from "supertest";
import { it, expect, vi } from "vitest";
const access = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../lib/session", () => ({
  getSessionFromRequest: () => ({ userId: 2, role: "vendor" }),
}));
vi.mock("../lib/objectStorage", () => ({
  ObjectNotFoundError: class extends Error {},
  ObjectStorageService: class {
    async getStoredObject() {
      return {
        contentType: "application/pdf",
        size: 5,
        body: Buffer.from("%PDF-"),
        acl: {
          owner: "2",
          visibility: "public",
          purpose: "fleet-compliance-private",
        },
      };
    }
    canAccessStoredObject = access;
  },
}));
import storage from "./storage";
it("denies direct private compliance URL even when generic ownership or public ACL would grant it", async () => {
  const app = express();
  app.use(storage);
  expect(
    (
      await request(app).get(
        "/storage/objects/fleet-compliance-private/1/record/1/file",
      )
    ).status,
  ).toBe(403);
  expect(access).not.toHaveBeenCalled();
});
