import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { buildTestCookie } from "../test-utils/session";

vi.mock("../work-hub/feature-access", () => ({ isWorkHubEnabled: async () => true }));
vi.mock("./workHubMeetings", async () => ({ default: (await import("express")).Router() }));
vi.mock("./workHubMeetingReplay", async () => ({ default: (await import("express")).Router() }));
vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  const rows = {
    from() { return this; },
    innerJoin() { return this; },
    where() { return this; },
    orderBy() { return this; },
    limit() { return Promise.resolve([]); },
  };
  return { ...original, db: { select: () => rows } };
});

import operations from "./workHubOperations";

const app = express().use(express.json()).use(cookieParser()).use(operations);

describe("Work Hub home capability response", () => {
  it("returns an intentional null projection for a managed worker whose site grants were removed", async () => {
    const cookie = buildTestCookie({
      userId: 34,
      role: "field_employee",
      vendorId: 12,
      managedSubcontractor: { siteGrants: [] },
    });
    const response = await request(app).get("/work-hub/home").set("Cookie", cookie);
    expect(response.status, response.text).toBe(200);
    expect(response.body).toMatchObject({
      capabilities: null,
      tasks: [],
      announcements: [],
      shifts: [],
      meetings: [],
    });
  });
});
