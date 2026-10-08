import express from "express";
import helmet from "helmet";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ visibility: "public", contentType: "image/png", allowed: true }));
vi.mock("../lib/session", () => ({ getSessionFromRequest: () => undefined }));
vi.mock("../lib/objectStorage", () => ({
  ObjectNotFoundError: class extends Error {},
  ObjectStorageService: class {
    async getStoredObject() {
      return { contentType: boundary.contentType, size: 3, body: Buffer.from([1, 2, 3]), acl: { visibility: boundary.visibility } };
    }
    async canAccessStoredObject() { return boundary.allowed; }
  },
}));
vi.mock("../lib/ticket-attachment-access", () => ({ canReadTicketAttachment: async () => false, ticketAttachmentReference: vi.fn() }));
vi.mock("../work-hub/file-access", () => ({ canReadWorkHubFile: async () => false }));
import storage from "./storage";
const app = express();
app.use(helmet());
app.use(storage);

describe("public organization image embedding", () => {
  beforeEach(() => { boundary.visibility = "public"; boundary.contentType = "image/png"; boundary.allowed = true; });
  it("allows an already-public image to render in the ChatGPT origin", async () => {
    const result = await request(app).get("/storage/objects/uploads/logo");
    expect(result.status).toBe(200);
    expect(result.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(result.headers["cache-control"]).toContain("public");
  });
  it("retains same-origin policy for permitted private images", async () => {
    boundary.visibility = "private";
    const result = await request(app).get("/storage/objects/uploads/private");
    expect(result.status).toBe(200);
    expect(result.headers["cross-origin-resource-policy"]).toBe("same-origin");
  });
  it("retains same-origin policy for public non-image files", async () => {
    boundary.contentType = "application/pdf";
    const result = await request(app).get("/storage/objects/uploads/document");
    expect(result.headers["cross-origin-resource-policy"]).toBe("same-origin");
  });
});
