import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

let selectRows: unknown[][] = [];

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.leftJoin = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => chain;
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy({ __name: name }, { get: (_t, k: string) => ({ __table: name, __col: k }) });
  const db: Record<string, unknown> = {
    select: () => makeChain(selectRows.shift() ?? []),
  };
  return {
    db,
    vendorRatingsTable: tableTag("vendorRatings"),
    partnersTable: tableTag("partners"),
    usersTable: tableTag("users"),
    vendorsTable: tableTag("vendors"),
    ticketsTable: tableTag("tickets"),
    siteLocationsTable: tableTag("siteLocations"),
    partnerVendorRelationshipsTable: tableTag("partnerVendorRelationships"),
  };
});

import vendorRatingsRouter from "./vendorRatings";

function app() {
  const a = express();
  a.use(cookieParser());
  a.use("/api", vendorRatingsRouter);
  attachTestErrorMiddleware(a);
  return a;
}

beforeEach(() => {
  selectRows = [
    [
      {
        id: 1,
        vendorId: 7,
        partnerId: 2,
        partnerName: "Acme Partner",
        userId: 10,
        userDisplayName: "Reviewer",
        ticketId: 100,
        rating: 5,
        review: "Great crew",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  ];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/vendors/:vendorId/ratings", () => {
  it("allows field employees to read their own vendor ratings", async () => {
    const res = await request(app())
      .get("/api/vendors/7/ratings")
      .set(
        "Cookie",
        buildTestCookie({
          userId: 99,
          role: "field_employee",
          vendorId: 7,
          partnerId: null,
        }),
      );

    expectStatus(res, 200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].rating).toBe(5);
  });

  it("403s field employees requesting another vendor's ratings", async () => {
    const res = await request(app())
      .get("/api/vendors/7/ratings")
      .set(
        "Cookie",
        buildTestCookie({
          userId: 99,
          role: "field_employee",
          vendorId: 8,
          partnerId: null,
        }),
      );

    expectStatus(res, 403);
  });
});
