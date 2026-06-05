import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { attachTestErrorMiddleware } from "../test-utils/route-app";
import { PUBLIC_UNAUTHENTICATED_ALLOWLIST } from "../lib/publicApiAllowlist";
import { isAllowlistedApiRoute } from "../lib/session";
import platformSettingsRouter from "./platformSettings";

process.env.SESSION_SECRET ??= "test-session-secret-for-public-brand-route";

const mockVendor = {
  id: 3,
  name: "Winchester",
  brandPrimaryColor: "#ceb673",
  brandAccentColor: "#616161",
  logoUrl: "/api/storage/objects/uploads/main",
  logoSquareUrl: "/api/storage/objects/uploads/square",
};

vi.mock("@workspace/db", () => {
  const vendorsTable = { __kind: "vendors" as const };
  const partnersTable = { __kind: "partners" as const };
  const platformSettingsTable = { id: "id" };
  const rowsForTable = (table: { __kind?: string }) => {
    if (table?.__kind === "vendors") return [mockVendor];
    if (table?.__kind === "partners") return [];
    return [
      {
        id: 1,
        name: "VNDRLY",
        brandPrimaryColor: "#e6ac00",
        brandAccentColor: "#616161",
        logoUrl: null,
        logoSquareUrl: null,
      },
    ];
  };
  const queryResult = (table: { __kind?: string }) => {
    const rows = rowsForTable(table);
    return {
      limit: vi.fn(async () => rows),
      then(onFulfilled: (value: typeof rows) => unknown) {
        return Promise.resolve(rows).then(onFulfilled);
      },
    };
  };
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn((table: { __kind?: string }) => ({
          where: vi.fn(() => queryResult(table)),
        })),
      })),
      insert: vi.fn(),
    },
    platformSettingsTable,
    platformSettingsAuditLogTable: { field: "field" },
    usersTable: { id: "id", displayName: "displayName" },
    partnersTable,
    vendorsTable,
  };
});

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/")) return next();
  if (isAllowlistedApiRoute(req, PUBLIC_UNAUTHENTICATED_ALLOWLIST)) return next();
  return res.status(401).json({
    error: "Authentication required",
    code: "auth.unauthenticated",
  });
});
app.use("/api", platformSettingsRouter);
attachTestErrorMiddleware(app, { logErrors: false });

describe("GET /api/public/platform-brand", () => {
  it("returns brand fields without a session", async () => {
    const res = await request(app).get("/api/public/platform-brand");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: "VNDRLY",
      brandPrimaryColor: "#e6ac00",
      brandAccentColor: "#616161",
      logoUrl: null,
      logoSquareUrl: null,
    });
  });

  it("rejects unauthenticated callers for non-public routes", async () => {
    const res = await request(app).get("/api/platform-settings");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.unauthenticated");
  });
});

describe("GET /api/public/login-brand", () => {
  it("returns the vendor brand from Postgres when vendorId is in the query", async () => {
    const res = await request(app).get("/api/public/login-brand?vendorId=3");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: "Winchester",
      brandPrimaryColor: "#ceb673",
      logoSquareUrl: "/api/storage/objects/uploads/square",
      isOrgBranded: true,
    });
  });

  it("returns an empty brand payload when no org id is provided", async () => {
    const res = await request(app).get("/api/public/login-brand");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: null,
      isOrgBranded: false,
    });
  });
});
