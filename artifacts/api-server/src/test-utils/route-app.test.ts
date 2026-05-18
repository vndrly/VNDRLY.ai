import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { z } from "zod";
import { attachTestErrorMiddleware, expectStatus } from "./route-app";

// Task #716 — `attachTestErrorMiddleware` and `expectStatus` exist to make
// fixture-shape bugs in route tests easy to diagnose. These tests pin the
// behaviour the rest of the route-test suite now depends on.

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());

  app.get("/zod", (_req, _res, next) => {
    try {
      z.object({ intakeChannel: z.string() }).parse({});
    } catch (err) {
      next(err);
    }
  });

  app.get("/boom", (_req, _res, next) => {
    next(new Error("kaboom from handler"));
  });

  attachTestErrorMiddleware(app, { logErrors: false });
  return app;
}

describe("attachTestErrorMiddleware", () => {
  it("surfaces ZodError issues in the JSON response body", async () => {
    const res = await request(buildApp()).get("/zod");
    expect(res.status).toBe(500);
    expect(res.body.name).toBe("ZodError");
    expect(Array.isArray(res.body.issues)).toBe(true);
    const issue = res.body.issues[0];
    expect(issue.pathStr).toBe("intakeChannel");
    // Zod 3 reports invalid_type for required-field misses; future Zod 4
    // upgrades may rename this to a different code, in which case bumping
    // the assertion is the smaller of two evils vs. losing the surface.
    expect(typeof issue.code).toBe("string");
  });

  it("falls back to err.message for plain Error throws", async () => {
    const res = await request(buildApp()).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("kaboom from handler");
    expect(res.body.issues).toBeUndefined();
  });
});

describe("expectStatus", () => {
  it("returns silently when the status matches", () => {
    expect(() =>
      expectStatus({ status: 200, body: { ok: true } }, 200),
    ).not.toThrow();
  });

  it("throws an Error embedding the response body on mismatch", () => {
    let thrown: unknown = null;
    try {
      expectStatus(
        {
          status: 500,
          body: { error: "bad fixture", issues: [{ pathStr: "intakeChannel" }] },
        },
        200,
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const msg = (thrown as Error).message;
    expect(msg).toContain("expected status 200 but got 500");
    expect(msg).toContain("intakeChannel");
    expect(msg).toContain("bad fixture");
  });

  it("falls back to res.text when body is empty", () => {
    let thrown: unknown = null;
    try {
      expectStatus(
        { status: 404, body: {}, text: "not found from upstream" },
        200,
      );
    } catch (err) {
      thrown = err;
    }
    expect((thrown as Error).message).toContain("not found from upstream");
  });
});
