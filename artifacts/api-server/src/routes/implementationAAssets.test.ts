import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestCookie } from "../test-utils/session";
import { createMemoryAssetRepository, type AssetRepository } from "../services/assets";

const state = vi.hoisted(() => ({
  repository: null as AssetRepository | null,
  policy: { photosRequiredOnCheckout: false, photosRequiredOnReturn: false, expectedReturnRequired: false, supervisorApprovalRequired: false, identifierRequired: false },
}));
vi.mock("../services/asset-database-repository", () => ({ databaseAssetRepository: {
  create: (...args: Parameters<AssetRepository["create"]>) => state.repository!.create(...args),
  get: (...args: Parameters<AssetRepository["get"]>) => state.repository!.get(...args),
  find: (...args: Parameters<AssetRepository["find"]>) => state.repository!.find(...args),
  save: (...args: Parameters<AssetRepository["save"]>) => state.repository!.save(...args),
  all: (...args: Parameters<AssetRepository["all"]>) => state.repository!.all(...args),
} }));
vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return { ...original, db: { select: () => ({ from: () => ({ innerJoin: () => ({ where: async () => [] }), where: () => ({ limit: async () => [state.policy] }) }) }) } };
});
import assetsRouter from "./implementationAAssets";

const app = express().use(express.json()).use(cookieParser()).use(assetsRouter);
const owner = { type: "vendor" as const, id: 7 };
const gatekeeper = buildTestCookie({ userId: 11, role: "field_employee", vendorId: 7, vendorRole: "gatekeeper" });
const otherGatekeeper = buildTestCookie({ userId: 15, role: "field_employee", vendorId: 7, vendorRole: "gatekeeper" });
const supervisor = buildTestCookie({ userId: 12, role: "field_employee", vendorId: 7, vendorRole: "gate_supervisor" });
const admin = buildTestCookie({ userId: 13, role: "vendor", vendorId: 7, membershipRole: "admin" });
const member = buildTestCookie({ userId: 14, role: "field_employee", vendorId: 7, membershipRole: "member" });
const command = (version: number, operationId = crypto.randomUUID()) => ({ operationId, expectedVersion: version, condition: "good", confirmed: true, photos: [] });

beforeEach(() => {
  state.repository = createMemoryAssetRepository();
  state.policy = { photosRequiredOnCheckout: false, photosRequiredOnReturn: false, expectedReturnRequired: false, supervisorApprovalRequired: false, identifierRequired: false };
});

describe("asset inventory and custody routes", () => {
  it("returns canonical assets and capability object to a gatekeeper", async () => {
    await state.repository!.create({ name: "Radio", category: "equipment", legalOwner: "Vendor", responsibleOwner: owner, aliases: [], provisional: false });
    const response = await request(app).get("/implementation-a/assets").set("Cookie", gatekeeper);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ assets: expect.any(Array), capabilities: expect.objectContaining({ canCheckOutAsset: true, canVerifyIssuedAsset: true, canManageAsset: false }) }));
    expect(response.body.assets[0]).toMatchObject({ name: "Radio", currentLocation: null });
  });

  it("denies catalog mutation to a gatekeeper", async () => {
    const response = await request(app).post("/implementation-a/assets").set("Cookie", gatekeeper).send({ name: "Radio", category: "equipment", legalOwner: "Vendor", responsibleOwner: owner, aliases: [] });
    expect(response.status).toBe(403);
  });

  it("denies custody changes to an ordinary vendor member", async () => {
    const asset = await state.repository!.create({ name: "Radio", category: "equipment", legalOwner: "Vendor", responsibleOwner: owner, aliases: [], provisional: false });
    expect((await request(app).post(`/implementation-a/assets/${asset.id}/checkout`).set("Cookie", member).send(command(1))).status).toBe(403);
    const condition = await request(app).post(`/implementation-a/assets/${asset.id}/condition`).set("Cookie", member).send({ condition: "damaged", expectedVersion: 1 });
    expect(condition.status).toBe(403);
  });

  it("lets an admin manage the catalog", async () => {
    const response = await request(app).post("/implementation-a/assets").set("Cookie", admin).send({ name: "Radio", category: "equipment", legalOwner: "Vendor", responsibleOwner: owner, aliases: [] });
    expect(response.status).toBe(201);
  });

  it("applies gatekeeper self checkout once and rejects a stale version", async () => {
    const asset = await state.repository!.create({ name: "Radio", category: "equipment", legalOwner: "Vendor", responsibleOwner: owner, aliases: [], provisional: false });
    const first = await request(app).post(`/implementation-a/assets/${asset.id}/checkout`).set("Cookie", gatekeeper).send(command(1));
    expect(first.body).toMatchObject({ status: "applied", asset: { holderUserId: 11, version: 2 } });
    const stale = await request(app).post(`/implementation-a/assets/${asset.id}/checkout`).set("Cookie", gatekeeper).send(command(1));
    expect(stale.body).toMatchObject({ status: "conflict", code: "asset.version_conflict" });
  });

  it("blocks checkout when held or category evidence is missing", async () => {
    const asset = await state.repository!.create({ name: "Radio", category: "equipment", legalOwner: "Vendor", responsibleOwner: owner, aliases: [], provisional: false });
    state.policy.photosRequiredOnCheckout = true;
    state.policy.expectedReturnRequired = true;
    const missing = await request(app).post(`/implementation-a/assets/${asset.id}/checkout`).set("Cookie", gatekeeper).send(command(1));
    expect(missing.body.code).toBe("asset.checkout_photos_required");
    const complete = await request(app).post(`/implementation-a/assets/${asset.id}/checkout`).set("Cookie", gatekeeper).send({ ...command(1), photos: ["https://example.test/radio.jpg"], expectedReturnAt: "2026-10-01T12:00:00Z" });
    expect(complete.body.status).toBe("applied");
    await state.repository!.save({ ...complete.body.asset, expectedReturnAt: new Date("2026-10-01T12:00:00Z"), status: "held" }, 2);
    const held = await request(app).post(`/implementation-a/assets/${asset.id}/checkout`).set("Cookie", gatekeeper).send({ ...command(3), photos: ["https://example.test/radio.jpg"], expectedReturnAt: "2026-10-01T12:00:00Z" });
    expect(held.body).toMatchObject({ status: "blocked", code: "asset.on_hold" });
  });

  it("requires supervisor approval when category policy says so", async () => {
    const asset = await state.repository!.create({ name: "Radio", category: "equipment", legalOwner: "Vendor", responsibleOwner: owner, aliases: [], provisional: false });
    state.policy.supervisorApprovalRequired = true;
    const denied = await request(app).post(`/implementation-a/assets/${asset.id}/checkout`).set("Cookie", gatekeeper).send(command(1));
    expect(denied.status).toBe(403);
    const approved = await request(app).post(`/implementation-a/assets/${asset.id}/checkout`).set("Cookie", supervisor).send(command(1));
    expect(approved.body).toMatchObject({ status: "applied", asset: { holderUserId: 12 } });
  });

  it("lets a gatekeeper verify only an asset they issued and a supervisor oversee crew custody", async () => {
    const asset = await state.repository!.create({ name: "Radio", category: "equipment", legalOwner: "Vendor", responsibleOwner: owner, aliases: [], provisional: false });
    const checked = await request(app).post(`/implementation-a/assets/${asset.id}/checkout`).set("Cookie", gatekeeper).send(command(1));
    expect(checked.body.status).toBe("applied");
    const denied = await request(app).post(`/implementation-a/assets/${asset.id}/verify-issued`).set("Cookie", member).send(command(2));
    expect(denied.status).toBe(403);
    const notIssuer = await request(app).post(`/implementation-a/assets/${asset.id}/verify-issued`).set("Cookie", otherGatekeeper).send(command(2));
    expect(notIssuer.status).toBe(403);
    const verified = await request(app).post(`/implementation-a/assets/${asset.id}/verify-issued`).set("Cookie", gatekeeper).send(command(2));
    expect(verified.body).toMatchObject({ status: "applied", asset: { version: 3 } });
    const oversight = await request(app).post(`/implementation-a/assets/${asset.id}/return`).set("Cookie", supervisor).send(command(3));
    expect(oversight.body).toMatchObject({ status: "applied", asset: { holderUserId: null } });
  });

  it("accepts the same return operation after custody is cleared", async () => {
    const asset = await state.repository!.create({ name: "Radio", category: "equipment", legalOwner: "Vendor", responsibleOwner: owner, aliases: [], provisional: false });
    await request(app).post(`/implementation-a/assets/${asset.id}/checkout`).set("Cookie", gatekeeper).send(command(1));
    const input = command(2);
    const first = await request(app).post(`/implementation-a/assets/${asset.id}/return`).set("Cookie", gatekeeper).send(input);
    const retry = await request(app).post(`/implementation-a/assets/${asset.id}/return`).set("Cookie", gatekeeper).send(input);
    expect(first.body).toMatchObject({ status: "applied", version: 3 });
    expect(retry.body).toMatchObject({ status: "applied", version: 3 });
  });
});
