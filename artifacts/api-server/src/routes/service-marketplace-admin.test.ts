import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildTestCookie } from "../test-utils/session";
import {
  createServiceMatching,
  type MappingRepository,
  type StoredServiceMapping,
} from "../services/service-matching";
import {
  createServiceMarketplaceAdminRouter,
  type AdminMarketplaceStore,
} from "./serviceMarketplaceAdmin";
import { subjectFingerprint } from "../services/service-matching/candidates";

const subject = {
  subjectType: "partner_work_type" as const,
  subjectId: 21,
  name: "Gatekeeping",
  description: "Visitor logs",
  category: "Security",
  active: true,
};
const concept = {
  id: 5,
  code: "gate_security",
  name: "Gate security",
  category: "Security",
  definition: "Control entry",
  inclusionGuidance: null,
  exclusionGuidance: null,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const admin = buildTestCookie({ userId: 7, role: "admin" });
let rows: StoredServiceMapping[];
let app: express.Express;
let active: boolean;
let classifierUnavailable: boolean;

beforeEach(() => {
  active = true;
  classifierUnavailable = false;
  rows = [
    {
      id: 1,
      subjectType: subject.subjectType,
      subjectId: 21,
      workTypeId: 21,
      vendorCapabilityId: null,
      canonicalServiceId: 5,
      status: "review_required",
      confidence: "0.74000",
      explanation: "Controlled entry and visitor logs",
      evidence: { features: ["entry", "logs"] },
      modelVersion: "model:v1",
      mappingVersion: 1,
      actorUserId: null,
      actorProcess: "classifier",
      createdAt: new Date(),
      reviewedAt: null,
      supersededAt: null,
    },
  ];
  const repository: MappingRepository = {
    async withSubjectLock(_subject, run) {
      return run({
        loadSubject: async () => subject,
        listMappings: async () => rows,
        isCanonicalServiceActive: async () => active,
        supersede: async (id, at) => {
          const row = rows.find((r) => r.id === id)!;
          row.status = "superseded";
          row.supersededAt = at;
        },
        insert: async (row) => {
          const saved = { ...row, id: rows.length + 1, createdAt: new Date() };
          rows.push(saved);
          return saved;
        },
      });
    },
  };
  const matching = createServiceMatching({
    repository,
    activationThreshold: 0.95,
    candidateProvider: {
      findCandidates: async () => [{ ...concept, aliases: [] }],
    },
    classifier: {
      classify: async () => {
        if (classifierUnavailable) throw new Error("Provider unavailable");
        return {
          outcome: "matched",
          canonicalServiceId: 5,
          confidence: 0.99,
          explanation: "Same operational service",
          evidence: { source: "definition" },
          modelVersion: "model:v2",
          subjectFingerprint: "stamped-by-engine",
        };
      },
    },
  });
  const store: AdminMarketplaceStore = {
    getMapping: async (id) => rows.find((row) => row.id === id) ?? null,
    listMappings: async (limit, offset) => ({
      items: rows
        .filter(
          (r) =>
            r.status === "review_required" &&
            r.mappingVersion === Math.max(...rows.map((x) => x.mappingVersion)),
        )
        .slice(offset, offset + limit)
        .map((mapping) => ({ ...mapping, subject, canonicalService: concept })),
      total: rows.at(-1)?.status === "review_required" ? 1 : 0,
    }),
    listServices: async () => ({
      items: [{ ...concept, active, aliases: [] }],
      total: 1,
    }),
    createService: async (value) => ({ ...concept, ...value }),
    updateService: async (_id, value) => ({ ...concept, ...value }),
    archiveService: async () => {
      active = false;
      return { ...concept, active: false };
    },
    addAlias: async (_id, value) => ({
      id: 9,
      canonicalServiceId: 5,
      ...value,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    updateAlias: async (_id, _aliasId, value) => ({
      id: 9,
      canonicalServiceId: 5,
      alias: "Gate Services",
      industry: null,
      region: null,
      provenance: "platform",
      active: true,
      ...value,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  };
  app = express()
    .use(cookieParser())
    .use(express.json())
    .use(
      "/api",
      createServiceMarketplaceAdminRouter({ store, repository, matching }),
    );
});

describe("admin service mapping review", () => {
  it.each([
    undefined,
    buildTestCookie({ userId: 9, role: "vendor" }),
    buildTestCookie({ role: "admin" }),
    buildTestCookie({ role: "admin", userId: 0 }),
  ])("denies every endpoint without an identified admin", async (cookie) => {
    for (const [method, path] of [
      ["get", "/admin/service-mappings"],
      ["get", "/admin/service-subjects/partner_work_type/21/mappings"],
      ["post", "/admin/service-mappings/1/review"],
      ["post", "/admin/service-subjects/partner_work_type/21/reclassify"],
      ["get", "/admin/canonical-services"],
      ["post", "/admin/canonical-services"],
      ["patch", "/admin/canonical-services/5"],
      ["delete", "/admin/canonical-services/5"],
      ["post", "/admin/canonical-services/5/aliases"],
      ["patch", "/admin/canonical-services/5/aliases/9"],
    ] as const) {
      const call = request(app)[method](`/api${path}`);
      if (cookie) call.set("Cookie", cookie);
      expect((await call.send({})).status).toBe(403);
    }
    expect(rows).toHaveLength(1);
  });

  it("returns subject text and complete review evidence", async () => {
    const result = await request(app)
      .get("/api/admin/service-mappings")
      .set("Cookie", admin);
    expect(result.status).toBe(200);
    expect(result.body.items[0]).toMatchObject({
      status: "review_required",
      confidence: 0.74,
      evidenceSummary: "Controlled entry and visitor logs",
      modelVersion: "model:v1",
      subject: { name: "Gatekeeping" },
      canonicalService: { name: "Gate security" },
    });
  });

  it("appends approvals, rejects, and remaps without overwriting the proposal", async () => {
    const approve = await request(app)
      .post("/api/admin/service-mappings/1/review")
      .set("Cookie", admin)
      .send({ action: "approve", reason: "Verified definition" });
    expect(approve.status).toBe(200);
    expect(approve.body.mapping).toMatchObject({
      id: 2,
      status: "active",
      actorUserId: 7,
      modelVersion: "model:v1",
      confidence: 0.74,
    });
    expect(rows[0]).toMatchObject({
      status: "review_required",
      reviewedAt: null,
    });
    const remap = await request(app)
      .post("/api/admin/service-mappings/2/review")
      .set("Cookie", admin)
      .send({
        action: "remap",
        canonicalServiceId: 5,
        reason: "Confirmed scope",
      });
    expect(remap.status).toBe(200);
    expect(rows[1].status).toBe("superseded");
    const reject = await request(app)
      .post("/api/admin/service-mappings/3/review")
      .set("Cookie", admin)
      .send({ action: "reject", reason: "Different operation" });
    expect(reject.status).toBe(200);
    expect(reject.body).toMatchObject({
      mapping: {
        status: "rejected",
        evidenceSummary: "Different operation",
        modelVersion: "model:v1",
        confidence: 0.74,
      },
      currentMapping: null,
    });
    expect(rows).toHaveLength(4);
    expect(rows[3].evidence).toMatchObject({
      adminReview: {
        sourceMappingId: 3,
        action: "reject",
        reason: "Different operation",
      },
    });
  });

  it("retries the same review without appending a second decision and rejects stale changes", async () => {
    const call = () =>
      request(app)
        .post("/api/admin/service-mappings/1/review")
        .set("Cookie", admin)
        .send({ action: "approve", reason: "Verified" });
    expect((await call()).status).toBe(200);
    expect((await call()).body.mapping.id).toBe(2);
    expect(rows).toHaveLength(2);
    expect(
      (
        await request(app)
          .post("/api/admin/service-mappings/1/review")
          .set("Cookie", admin)
          .send({ action: "reject", reason: "Stale" })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .get("/api/admin/service-mappings")
          .set("Cookie", admin)
      ).body.total,
    ).toBe(0);
  });

  it("archives a referenced concept and refuses new active mappings to it", async () => {
    const archived = await request(app)
      .delete("/api/admin/canonical-services/5")
      .set("Cookie", admin);
    expect(archived.status).toBe(200);
    expect(archived.body.active).toBe(false);
    expect(rows[0].canonicalServiceId).toBe(5);
    const result = await request(app)
      .post("/api/admin/service-mappings/1/review")
      .set("Cookie", admin)
      .send({ action: "approve", reason: "Verified" });
    expect(result.status).toBe(409);
    expect(rows).toHaveLength(1);
  });

  it("uses saved subject text and makes repeated reclassification idempotent", async () => {
    const run = () =>
      request(app)
        .post("/api/admin/service-subjects/partner_work_type/21/reclassify")
        .set("Cookie", admin)
        .send({ name: "Injected name" });
    const first = await run();
    expect(first.status).toBe(200);
    expect(first.body.mapping).toMatchObject({
      status: "active",
      modelVersion: "model:v2",
      confidence: 0.99,
      evidenceSummary: "Same operational service",
    });
    expect((await run()).body.mapping.id).toBe(first.body.mapping.id);
    expect(rows).toHaveLength(2);
  });

  it("rejects malformed review, service, alias, and pagination input", async () => {
    expect(
      (
        await request(app)
          .post("/api/admin/service-mappings/1/review")
          .set("Cookie", admin)
          .send({ action: "remap", reason: "" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/admin/canonical-services")
          .set("Cookie", admin)
          .send({ name: "" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/admin/canonical-services/5/aliases")
          .set("Cookie", admin)
          .send({ alias: " " })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .get("/api/admin/service-mappings?limit=10000")
          .set("Cookie", admin)
      ).status,
    ).toBe(400);
  });

  it("refuses to approve a classification when saved subject wording has changed", async () => {
    rows[0].evidence = {
      serviceMatching: {
        subjectFingerprint: subjectFingerprint({
          ...subject,
          description: "Old scope before an edit",
        }),
      },
    };
    const result = await request(app)
      .post("/api/admin/service-mappings/1/review")
      .set("Cookie", admin)
      .send({ action: "approve", reason: "Verified" });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("service_mapping.subject_changed");
    expect(rows).toHaveLength(1);
  });

  it("returns durable version history and current mapping after review", async () => {
    await request(app)
      .post("/api/admin/service-mappings/1/review")
      .set("Cookie", admin)
      .send({ action: "approve", reason: "Verified" });
    const result = await request(app)
      .get("/api/admin/service-subjects/partner_work_type/21/mappings?limit=1")
      .set("Cookie", admin);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      total: 2,
      limit: 1,
      offset: 0,
      currentMapping: { id: 2, status: "active" },
    });
    expect(result.body.items).toHaveLength(1);
    expect(result.body.items[0]).toMatchObject({
      mappingVersion: 2,
      actorUserId: 7,
      confidence: 0.74,
      evidenceSummary: "Verified",
      modelVersion: "model:v1",
    });
  });

  it("leaves an existing active mapping untouched when reclassification is unavailable", async () => {
    rows[0].status = "active";
    classifierUnavailable = true;
    const result = await request(app)
      .post("/api/admin/service-subjects/partner_work_type/21/reclassify")
      .set("Cookie", admin);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      status: "pending",
      retryable: true,
      mapping: null,
      currentMapping: {
        id: 1,
        status: "active",
        confidence: 0.74,
        evidenceSummary: "Controlled entry and visitor logs",
        modelVersion: "model:v1",
      },
    });
    expect(rows).toHaveLength(1);
  });

  it("requires a real concept for a novel proposal and supports explicit remapping", async () => {
    rows[0].canonicalServiceId = null;
    const approve = await request(app)
      .post("/api/admin/service-mappings/1/review")
      .set("Cookie", admin)
      .send({ action: "approve", reason: "Reviewed" });
    expect(approve.status).toBe(409);
    const remap = await request(app)
      .post("/api/admin/service-mappings/1/review")
      .set("Cookie", admin)
      .send({
        action: "remap",
        canonicalServiceId: 5,
        reason: "Reviewed existing concept",
      });
    expect(remap.status).toBe(200);
    expect(remap.body.currentMapping).toMatchObject({
      canonicalServiceId: 5,
      status: "active",
    });
  });
});
