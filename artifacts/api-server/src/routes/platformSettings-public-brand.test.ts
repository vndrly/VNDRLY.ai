import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { attachTestErrorMiddleware } from "../test-utils/route-app";
import { PUBLIC_UNAUTHENTICATED_ALLOWLIST } from "../lib/publicApiAllowlist";
import { isAllowlistedApiRoute } from "../lib/session";
import platformSettingsRouter from "./platformSettings";

process.env.SESSION_SECRET ??= "test-session-secret-for-public-brand-route";

vi.mock("@workspace/db", () => {
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [
            {
              id: 1,
              name: "VNDRLY",
              brandPrimaryColor: "#e6ac00",
              brandAccentColor: "#616161",
              logoUrl: null,
              logoSquareUrl: null,
            },
          ]),
        })),
      })),
      insert: vi.fn(),
    },
    platformSettingsTable: { id: "id" },
    platformSettingsAuditLogTable: { field: "field" },
    usersTable: { id: "id", displayName: "displayName" },
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
