import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requireIsolatedFixtureContext } from "./isolated-fixture-guard";
import {
  freshLocalChildEnvironment,
  resolveFreshLocalTestDatabaseTarget,
} from "../../../../scripts/fresh-test-database.mjs";

const originalEnvironment = {
  DATABASE_URL: process.env.DATABASE_URL,
  LISTEN_NOTIFY_DATABASE_URL: process.env.LISTEN_NOTIFY_DATABASE_URL,
  PGPORT: process.env.PGPORT,
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  VNDRLY_ISOLATED_TEST_DB: process.env.VNDRLY_ISOLATED_TEST_DB,
  VNDRLY_TEST_DB_MODE: process.env.VNDRLY_TEST_DB_MODE,
  VNDRLY_FRESH_TEST_DB_NAME: process.env.VNDRLY_FRESH_TEST_DB_NAME,
  VNDRLY_LOAD_ENV_LOCAL: process.env.VNDRLY_LOAD_ENV_LOCAL,
};

function restoreEnvironment(key: keyof typeof originalEnvironment): void {
  const original = originalEnvironment[key];
  if (original === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = original;
  }
}

afterEach(() => {
  restoreEnvironment("DATABASE_URL");
  restoreEnvironment("LISTEN_NOTIFY_DATABASE_URL");
  restoreEnvironment("PGPORT");
  restoreEnvironment("TEST_DATABASE_URL");
  restoreEnvironment("VNDRLY_ISOLATED_TEST_DB");
  restoreEnvironment("VNDRLY_TEST_DB_MODE");
  restoreEnvironment("VNDRLY_FRESH_TEST_DB_NAME");
  restoreEnvironment("VNDRLY_LOAD_ENV_LOCAL");
});

function fixtureApp(databaseAction: () => void) {
  const app = express();
  app.post("/fixture", requireIsolatedFixtureContext, (_req, res) => {
    databaseAction();
    res.status(204).send();
  });
  return app;
}

describe("requireIsolatedFixtureContext", () => {
  it("refuses before any database action when the isolated marker is absent", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.LISTEN_NOTIFY_DATABASE_URL;
    delete process.env.TEST_DATABASE_URL;
    delete process.env.VNDRLY_ISOLATED_TEST_DB;
    const databaseAction = vi.fn();

    const response = await request(fixtureApp(databaseAction)).post("/fixture");

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("fixture.isolated_test_database_required");
    expect(databaseAction).not.toHaveBeenCalled();
  });

  it("refuses before any database action when only the marker is present", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.LISTEN_NOTIFY_DATABASE_URL;
    delete process.env.TEST_DATABASE_URL;
    process.env.VNDRLY_ISOLATED_TEST_DB = "1";
    const databaseAction = vi.fn();

    const response = await request(fixtureApp(databaseAction)).post("/fixture");

    expect(response.status).toBe(503);
    expect(databaseAction).not.toHaveBeenCalled();
  });

  it("refuses before any database action when the matching target lacks _test", async () => {
    process.env.VNDRLY_ISOLATED_TEST_DB = "1";
    process.env.DATABASE_URL =
      "postgresql://runner:secret@isolated.example.test:5432/vndrly";
    process.env.TEST_DATABASE_URL = process.env.DATABASE_URL;
    const databaseAction = vi.fn();

    const response = await request(fixtureApp(databaseAction)).post("/fixture");

    expect(response.status).toBe(503);
    expect(databaseAction).not.toHaveBeenCalled();
  });

  it("refuses before any database action when normalized targets differ", async () => {
    process.env.VNDRLY_ISOLATED_TEST_DB = "1";
    process.env.DATABASE_URL =
      "postgresql://runner:secret@one.example.test:5432/vndrly_test";
    process.env.TEST_DATABASE_URL =
      "postgresql://runner:secret@two.example.test:5432/vndrly_test";
    const databaseAction = vi.fn();

    const response = await request(fixtureApp(databaseAction)).post("/fixture");

    expect(response.status).toBe(503);
    expect(databaseAction).not.toHaveBeenCalled();
  });

  it("refuses query parameters with encoded controls before any database action", async () => {
    process.env.VNDRLY_ISOLATED_TEST_DB = "1";
    process.env.DATABASE_URL =
      "postgresql://runner:secret@isolated.example.test:5432/vndrly_test?application_name=%00evil";
    process.env.TEST_DATABASE_URL = process.env.DATABASE_URL;
    const databaseAction = vi.fn();

    const response = await request(fixtureApp(databaseAction)).post("/fixture");

    expect(response.status).toBe(503);
    expect(databaseAction).not.toHaveBeenCalled();
  });

  it("refuses an omitted URL port even when PGPORT supplies one", async () => {
    process.env.VNDRLY_ISOLATED_TEST_DB = "1";
    process.env.PGPORT = "5432";
    process.env.DATABASE_URL =
      "postgresql://runner:secret@isolated.example.test/vndrly_test";
    process.env.TEST_DATABASE_URL = process.env.DATABASE_URL;
    const databaseAction = vi.fn();

    const response = await request(fixtureApp(databaseAction)).post("/fixture");

    expect(response.status).toBe(503);
    expect(databaseAction).not.toHaveBeenCalled();
  });

  it("permits the database action when the marker and exact safe URLs are present", async () => {
    // This case intentionally covers the legacy marker contract.
    delete process.env.VNDRLY_TEST_DB_MODE;
    process.env.VNDRLY_ISOLATED_TEST_DB = "1";
    process.env.DATABASE_URL =
      "postgres://runner:first@ISOLATED.EXAMPLE.TEST:5432/vndrly_test";
    process.env.TEST_DATABASE_URL =
      "postgresql://runner:second@isolated.example.test:5432/vndrly_test";
    const databaseAction = vi.fn();

    const response = await request(fixtureApp(databaseAction)).post("/fixture");

    expect(response.status).toBe(204);
    expect(databaseAction).toHaveBeenCalledTimes(1);
  });

  it("permits fresh local provenance and rejects a redirected LISTEN/NOTIFY target before the action", async () => {
    const target = resolveFreshLocalTestDatabaseTarget({
      VNDRLY_TEST_DB_MODE: "fresh-local",
      VNDRLY_TEST_DB_MAINTENANCE_URL:
        "postgresql://runner:local@127.0.0.1:55439/postgres",
    });
    const fresh = freshLocalChildEnvironment({}, target);
    for (const key of Object.keys(originalEnvironment) as Array<
      keyof typeof originalEnvironment
    >) {
      const value = fresh[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const databaseAction = vi.fn();
    expect(
      (await request(fixtureApp(databaseAction)).post("/fixture")).status,
    ).toBe(204);
    expect(databaseAction).toHaveBeenCalledTimes(1);
    process.env.LISTEN_NOTIFY_DATABASE_URL =
      "postgresql://runner:local@remote.example:55439/postgres";
    expect(
      (await request(fixtureApp(databaseAction)).post("/fixture")).status,
    ).toBe(503);
    expect(databaseAction).toHaveBeenCalledTimes(1);
  });
});
