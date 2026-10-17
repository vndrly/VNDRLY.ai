import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { expect, it } from "vitest";
import { buildTestCookie } from "../test-utils/session";
async function app() {
  const parser = await import("./fleet-compliance-body-parser").catch(
      () => null,
    ),
    server = express().use(cookieParser());
  if (parser) server.use(parser.default);
  server.use(express.json({ limit: "2mb" }));
  server.post("/api/fleet/compliance/documents", (req, res) =>
    res.json({ received: req.body.bodyBase64.length }),
  );
  server.post("/api/ordinary", (_req, res) => res.json({ accepted: true }));
  return server;
}
const cookie = () =>
  buildTestCookie({ userId: 42, role: "vendor", vendorId: 7, sv: 1 });
it("admits bounded base64 compliance documents through the actual parser without widening ordinary JSON requests", async () => {
  const server = await app(),
    body = { bodyBase64: "A".repeat(3 * 1024 * 1024) };
  const uploaded = await request(server)
    .post("/api/fleet/compliance/documents")
    .set("Cookie", cookie())
    .send(body);
  expect(uploaded.status).toBe(200);
  expect(uploaded.body.received).toBe(body.bodyBase64.length);
  expect(
    (
      await request(server)
        .post("/api/ordinary")
        .set("Cookie", cookie())
        .send(body)
    ).status,
  ).toBe(413);
});
it("requires a signed staff session before parsing large private-document bodies", async () => {
  const server = await app(),
    body = { bodyBase64: "A".repeat(3 * 1024 * 1024) };
  expect(
    (await request(server).post("/api/fleet/compliance/documents").send(body))
      .status,
  ).toBe(401);
  const token = cookie().split(";")[0].split("=").slice(1).join("=");
  expect(
    (
      await request(server)
        .post("/api/fleet/compliance/documents")
        .set("Authorization", `Bearer ${decodeURIComponent(token)}`)
        .send(body)
    ).status,
  ).toBe(200);
});
it("rejects oversized and malformed document requests with bounded safe errors", async () => {
  const server = await app();
  const huge = await request(server)
    .post("/api/fleet/compliance/documents")
    .set("Cookie", cookie())
    .send({ bodyBase64: "A".repeat(15 * 1024 * 1024) });
  expect(huge.status).toBe(413);
  expect(huge.body.code).toBe("fleet.document_too_large");
  const invalid = await request(server)
    .post("/api/fleet/compliance/documents")
    .set("Cookie", cookie())
    .set("Content-Type", "application/json")
    .send("{");
  expect(invalid.status).toBe(400);
  expect(invalid.body.code).toBe("fleet.invalid_request");
});
