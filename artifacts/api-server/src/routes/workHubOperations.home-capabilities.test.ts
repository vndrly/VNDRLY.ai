import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { buildTestCookie } from "../test-utils/session";

const { selectCalls } = vi.hoisted(() => ({ selectCalls: vi.fn() }));
vi.mock("../work-hub/feature-access", () => ({ isWorkHubEnabled: async () => true }));
vi.mock("./workHubMeetings", async () => ({ default: (await import("express")).Router() }));
vi.mock("./workHubMeetingReplay", async () => ({ default: (await import("express")).Router() }));
vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  const staleSummaries = [
    [{ id: "previously-assigned-task" }],
    [],
    [{ shift: { id: "previously-assigned-shift" } }],
    [{ meeting: { id: "previously-invited-meeting" } }],
  ];
  return { ...original, db: { select: () => {
    const index = selectCalls.mock.calls.length;
    selectCalls();
    const query = {
      from() { return this; },
      innerJoin() { return this; },
      where() { return this; },
      orderBy() { return this; },
      limit() { return Promise.resolve(staleSummaries[index] ?? []); },
    };
    return query;
  } } };
});

import operations from "./workHubOperations";

const app = express().use(express.json()).use(cookieParser()).use(operations);

describe("Work Hub home capability response", () => {
  it("returns an intentional null projection for a managed worker whose site grants were removed", async () => {
    selectCalls.mockClear();
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
    expect(selectCalls).not.toHaveBeenCalled();
  });
});
