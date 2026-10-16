import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { FleetComplianceRecordSchema } from "@workspace/api-zod";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import {
  databaseFleetRepository,
  emptyFleetState,
  type FleetState,
} from "./fleet-repository";
import { createFleetService, type FleetActor } from "./fleet-ops";
import type { PoolClient } from "pg";
import type { ObjectStore, StoredObject } from "../lib/objectStore";

async function fixture() {
  assertFreshLocalTestDatabaseEnvironment(process.env);
  const module = await import("./fleet-compliance").catch(() => null);
  expect(module, "Compliance service exists").not.toBeNull();
  const { db, pool, vendorsTable, usersTable, userOrgMembershipsTable } =
    await import("@workspace/db");
  const tag = randomUUID();
  const [vendor] = await db
    .insert(vendorsTable)
    .values({
      name: `Compliance ${tag}`,
      contactName: "Synthetic",
      contactEmail: `${tag}@example.invalid`,
    })
    .returning();
  const actors: FleetActor[] = [];
  for (const name of ["Admin", "Reviewer", "Driver", "Dispatcher"]) {
    const [user] = await db
      .insert(usersTable)
      .values({
        username: `${name}-${tag}@example.invalid`,
        passwordHash: "not-a-login",
        displayName: name,
        role: "vendor",
      })
      .returning();
    const [membership] = await db
      .insert(userOrgMembershipsTable)
      .values({
        userId: user.id,
        orgType: "vendor",
        vendorId: vendor.id,
        role: name === "Admin" ? "admin" : "member",
      })
      .returning();
    actors.push({
      userId: user.id,
      companyId: vendor.id,
      role: "vendor",
      sv: user.sessionVersion,
      activeMembershipId: membership.id,
      membershipRole: membership.role,
    });
  }
  const groupId = randomUUID(),
    state: FleetState = {
      ...emptyFleetState(),
      enabled: true,
      fleets: [
        {
          id: groupId,
          name: "Scope",
          equipmentAssetIds: [],
          siteIds: [],
          requiredCertifications: [],
        },
      ],
      grants: actors.map((actor, index) => ({
        userId: actor.userId,
        fleetIds: [groupId],
        siteIds: [],
        roles:
          index === 2
            ? ["driver"]
            : index === 3
              ? ["dispatcher"]
              : ["fleet_manager"],
        safetyRelease: false,
        financeRead: false,
      })),
    };
  await pool.query("UPDATE vendors SET fleet_ops_state=$2::jsonb WHERE id=$1", [
    vendor.id,
    JSON.stringify(state),
  ]);
  const objects = new Map<string, StoredObject>();
  const store = {
    kind: "filesystem",
    putObject: async (
      path: string,
      contentType: string,
      body: Buffer,
      acl: StoredObject["acl"],
    ) => {
      objects.set(path, { contentType, body, size: body.length, acl });
    },
    getObject: async (path: string) => objects.get(path) ?? null,
    getObjectAcl: async (path: string) => objects.get(path)?.acl ?? null,
  } as ObjectStore;
  const tx = <T>(
    actor: FleetActor,
    work: (state: FleetState, client: PoolClient) => Promise<T>,
  ) =>
    databaseFleetRepository.transaction(
      actor.companyId,
      actor.userId,
      work,
      actor,
    );
  const service = module!.createFleetComplianceOperations(
    tx,
    (s, a) => s.grants.find((row) => row.userId === a.userId) ?? null,
    {
      store: () => store,
      secret: () => "synthetic-test-hmac-not-a-credential",
      now: () => new Date("2026-10-16T18:00:00Z"),
    },
  );
  const [admin, reviewer, driver, dispatcher] = actors;
  const record = (kind = "driver_license") =>
    FleetComplianceRecordSchema.parse({
      evidence: {
        id: randomUUID(),
        revision: 1,
        subject: { kind: "driver", id: driver.userId },
        requirementId: kind,
        requirementVersion: 1,
        status: "document_received",
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2027-01-01T00:00:00Z",
        verifiedAt: null,
        verifiedByUserId: null,
        source: "User reported upload",
        privateDocumentRef: null,
        restrictions: {},
      },
      attributes:
        kind === "driver_medical"
          ? {
              kind,
              qualification: "qualified",
              examinerReference: "PRIVATE-EXAMINER",
              restrictions: [],
            }
          : {
              kind: "driver_license",
              issuingState: "OK",
              licenseNumber: "PRIVATE-LICENSE-123456789",
              licenseClass: "A",
              endorsements: ["N"],
              restrictions: [],
              licenseStatus: "active",
              sourceRecordId: null,
            },
      retentionClass: kind === "driver_medical" ? "medical" : "qualification",
      retainUntil: null,
      legalHold: false,
    });
  const source = {
    kind: "government_registry",
    reference: "PRIVATE-REGISTRY-REFERENCE",
    url: "https://example.gov/synthetic",
  };
  const appoint = async () =>
    service.saveComplianceReviewers(admin, {
      operationId: randomUUID(),
      expectedVersion: (await service.complianceConfiguration(admin)).version,
      reviewerUserIds: [reviewer.userId],
    });
  return {
    service,
    pool,
    objects,
    admin,
    reviewer,
    driver,
    dispatcher,
    record,
    source,
    appoint,
  };
}
describe("Private Fleet compliance register", () => {
  it("detects substituted private document bytes before serving the retained original", async () => {
    const f = await fixture();
    await f.appoint();
    const record = f.record();
    const file = await f.service.uploadComplianceDocument(f.driver, {
      operationId: randomUUID(),
      subject: record.evidence.subject,
      recordId: record.evidence.id,
      contentType: "application/pdf",
      bodyBase64: Buffer.from("%PDF- original credential").toString("base64"),
    });
    await f.service.saveFleetComplianceEvidence(f.driver, {
      operationId: randomUUID(),
      expectedVersion: 0,
      record: {
        ...record,
        evidence: { ...record.evidence, privateDocumentRef: file.objectPath },
      },
    });
    const old = f.objects.get(file.objectPath)!;
    f.objects.set(file.objectPath, {
      ...old,
      body: Buffer.from("%PDF- altered credential"),
    });
    await expect(
      f.service.readComplianceDocument(f.reviewer, record.evidence.id),
    ).rejects.toMatchObject({ code: "fleet.private_document_unavailable" });
  });
  it("retains designated-reviewer access to historical qualification files after the driver leaves and Fleet is disabled", async () => {
    const f = await fixture();
    await f.appoint();
    const record = f.record();
    await f.service.saveFleetComplianceEvidence(f.driver, {
      operationId: randomUUID(),
      expectedVersion: 0,
      record,
    });
    await f.pool.query(
      "DELETE FROM user_org_memberships WHERE id=$1 AND user_id=$2 AND vendor_id=$3",
      [f.driver.activeMembershipId, f.driver.userId, f.driver.companyId],
    );
    await f.pool.query(
      "UPDATE vendors SET fleet_ops_state=jsonb_set(fleet_ops_state,'{enabled}','false') WHERE id=$1",
      [f.admin.companyId],
    );
    expect(
      (
        await f.service.readPrivateComplianceRecord(
          f.reviewer,
          record.evidence.id,
        )
      ).evidence.subject,
    ).toEqual(record.evidence.subject);
    await expect(
      f.service.readPrivateComplianceRecord(f.admin, record.evidence.id),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("links every evidence revision to the same canonical Inventory asset without changing custody", async () => {
    const f = await fixture();
    const { db, assetsTable } = await import("@workspace/db");
    const [asset] = await db
      .insert(assetsTable)
      .values({
        name: "Synthetic inspection truck",
        category: "truck",
        legalOwnerName: "Synthetic",
        responsibleOrgType: "vendor",
        responsibleOrgId: f.admin.companyId,
        currentHolderUserId: f.driver.userId,
      })
      .returning();
    const record = {
      ...f.record(),
      evidence: {
        ...f.record().evidence,
        subject: { kind: "vehicle", id: asset.id },
        requirementId: "vehicle-inspection",
      },
      attributes: {
        kind: "credential",
        credentialType: "periodic_inspection",
        reference: "PRIVATE-REPORT",
        issuingAuthority: "Qualified inspector",
        states: ["OK"],
        cargoCodes: [],
      },
      retentionClass: "maintenance",
    };
    await f.service.saveFleetComplianceEvidence(f.admin, {
      operationId: randomUUID(),
      expectedVersion: 0,
      record,
    });
    await f.service.saveFleetComplianceEvidence(f.admin, {
      operationId: randomUUID(),
      expectedVersion: 1,
      record: { ...record, evidence: { ...record.evidence, revision: 2 } },
    });
    const saved = await f.pool.query(
      "SELECT fleet_compliance_record_ids,current_holder_user_id FROM assets WHERE id=$1",
      [asset.id],
    );
    expect(saved.rows[0]).toMatchObject({
      fleet_compliance_record_ids: [record.evidence.id],
      current_holder_user_id: f.driver.userId,
    });
  });
  it("suppresses verification actions for read-only reviewer sessions", async () => {
    const f = await fixture();
    await f.appoint();
    const record = f.record();
    await f.service.saveFleetComplianceEvidence(f.driver, {
      operationId: randomUUID(),
      expectedVersion: 0,
      record,
    });
    expect(
      (
        await f.service.readFleetComplianceRegister(
          { ...f.reviewer, readOnly: true },
          {},
        )
      ).entries[0].mayReview,
    ).toBe(false);
  });
  it("lets a current Fleet driver reach qualification onboarding before assignment to a partner site", async () => {
    const f = await fixture();
    expect(
      await createFleetService(databaseFleetRepository).complianceConfiguration(
        f.driver,
      ),
    ).toMatchObject({ isReviewer: false, mayAppointReviewers: false });
  });
  it("does not turn insurance green from document verification without a complete work-scope coverage assessment", async () => {
    const f = await fixture();
    await f.appoint();
    const id = randomUUID(),
      validFrom = "2026-01-01T00:00:00Z",
      validUntil = "2027-01-01T00:00:00Z";
    const record = {
      evidence: {
        ...f.record().evidence,
        id,
        subject: { kind: "carrier", id: f.admin.companyId },
        requirementId: "insurance",
        validFrom,
        validUntil,
      },
      attributes: {
        kind: "insurance",
        coverage: {
          id,
          revision: 1,
          policyNumber: "PRIVATE-POLICY",
          insuredLegalEntity: "PRIVATE-INSURED",
          privateDocumentRef: null,
          coverageType: "auto_liability",
          state: "document_received",
          reviewedByUserId: null,
          reviewedAt: null,
          validFrom,
          validUntil,
          carrierIds: [f.admin.companyId],
          states: ["OK"],
          cargoCodes: ["nonhaz_property"],
          equipmentIds: [],
          scopesReviewed: false,
          limitUSD: "750000",
          filingStatus: "unverified",
          filingVerifiedAt: null,
          underlyingPolicyId: null,
          attachmentPointUSD: null,
          followFormReviewed: false,
        },
      },
      retentionClass: "insurance",
      retainUntil: null,
      legalHold: false,
    };
    await f.service.adoptFleetRequirement(f.reviewer, {
      operationId: randomUUID(),
      expectedVersion: 0,
      requirement: {
        id: "insurance",
        version: 1,
        category: "insurance",
        label: "Liability coverage",
        subjectKinds: ["carrier"],
        jurisdiction: "OK",
        classification: "legal",
        effectiveFrom: "2026-01-01T00:00:00Z",
        effectiveUntil: null,
        applicability: { anyOf: [{ allOf: [] }] },
        renewalDays: null,
        dueSoonDays: 60,
        source: {
          url: "https://oklahoma.gov/occ.html",
          section: "OAC 165:30-3-11",
        },
      },
    });
    await f.service.saveFleetComplianceEvidence(f.admin, {
      operationId: randomUUID(),
      expectedVersion: 0,
      record,
    });
    await f.service.verifyFleetComplianceEvidence(f.reviewer, {
      operationId: randomUUID(),
      evidenceId: id,
      expectedVersion: 1,
      decision: "verified",
      source: f.source,
      reviewedAt: "2026-10-16T18:00:00Z",
    });
    expect(
      (
        await f.service.assessFleetComplianceSubjects(f.dispatcher, {
          subjects: [record.evidence.subject],
        })
      ).assessments[0].status,
    ).toBe("red");
  });
  it("deduplicates the 60/30/14/7-day reminder windows by evidence revision", async () => {
    const f = await fixture();
    const module = await import("./fleet-compliance-reminders").catch(
      () => null,
    );
    expect(module).not.toBeNull();
    const record = f.record();
    record.evidence.validUntil = "2026-12-01T00:00:00Z";
    await f.service.saveFleetComplianceEvidence(f.driver, {
      operationId: randomUUID(),
      expectedVersion: 0,
      record,
    });
    for (const days of [50, 25, 10, 5, 5])
      await module!.runFleetComplianceReminderScan(
        new Date(Date.parse(record.evidence.validUntil) - days * 86400000),
      );
    const notices = await f.pool.query(
      "SELECT dedupe_key,body FROM notifications WHERE user_id=$1 AND dedupe_key LIKE $2",
      [
        f.driver.userId,
        `fleet-compliance:${f.driver.companyId}:${record.evidence.id}:1:%`,
      ],
    );
    expect(notices.rows).toHaveLength(4);
    expect(
      notices.rows.map((row) => row.dedupe_key.split(":").at(-1)).sort(),
    ).toEqual(["14", "30", "60", "7"]);
    expect(JSON.stringify(notices.rows)).not.toContain("PRIVATE-LICENSE");
  });
  it("does not expose malformed private JSON in a storage exception", async () => {
    const f = await fixture();
    await f.appoint();
    const record = f.record();
    await f.service.saveFleetComplianceEvidence(f.driver, {
      operationId: randomUUID(),
      expectedVersion: 0,
      record,
    });
    const [path, object] = [...f.objects.entries()][0];
    f.objects.set(path, {
      ...object,
      body: Buffer.from("PRIVATE malformed medical bytes"),
    });
    await expect(
      f.service.readPrivateComplianceRecord(f.reviewer, record.evidence.id),
    ).rejects.toMatchObject({ code: "fleet.private_record_unavailable" });
  });
  it("requires sourced applicability facts and exposes the assessment on the operational register", async () => {
    const f = await fixture();
    await f.appoint();
    const record = f.record();
    const requirement = {
      id: "driver_license",
      version: 1,
      category: "driver_license",
      label: "Required CDL status",
      subjectKinds: ["driver"],
      jurisdiction: "federal",
      classification: "legal",
      effectiveFrom: "2026-01-01T00:00:00Z",
      effectiveUntil: null,
      applicability: {
        anyOf: [
          { allOf: [{ fact: "cdlRequired", operator: "eq", value: true }] },
        ],
      },
      renewalDays: null,
      dueSoonDays: 60,
      source: {
        url: "https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-383",
        section: "383.23",
      },
    };
    await f.service.adoptFleetRequirement(f.reviewer, {
      operationId: randomUUID(),
      expectedVersion: 0,
      requirement,
    });
    await f.service.saveFleetComplianceEvidence(f.driver, {
      operationId: randomUUID(),
      expectedVersion: 0,
      record,
    });
    await f.service.verifyFleetComplianceEvidence(f.reviewer, {
      operationId: randomUUID(),
      evidenceId: record.evidence.id,
      expectedVersion: 1,
      decision: "verified",
      source: f.source,
      reviewedAt: "2026-10-16T18:00:00Z",
    });
    expect(
      (
        await f.service.assessFleetComplianceSubjects(f.dispatcher, {
          subjects: [record.evidence.subject],
        })
      ).assessments[0].status,
    ).toBe("red");
    await expect(
      f.service.recordFleetComplianceFacts(f.dispatcher, {
        operationId: randomUUID(),
        expectedVersion: 0,
        subject: record.evidence.subject,
        facts: { cdlRequired: true },
        source: f.source,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await f.service.recordFleetComplianceFacts(f.reviewer, {
      operationId: randomUUID(),
      expectedVersion: 0,
      subject: record.evidence.subject,
      facts: { cdlRequired: true },
      source: f.source,
    });
    expect([...f.objects.keys()].some((path) => /[<>:"|?*]/.test(path))).toBe(
      false,
    );
    expect(
      (await f.service.readFleetComplianceRegister(f.dispatcher, {})).entries[0]
        .status,
    ).toBe("green");
    expect(() =>
      f.service.recordFleetComplianceFacts(f.reviewer, {
        operationId: randomUUID(),
        expectedVersion: 1,
        subject: record.evidence.subject,
        facts: { cdlRequired: true, medicalDiagnosis: "private data" },
        source: f.source,
      }),
    ).toThrow();
  });
  it("requires a designated human to adopt a sourced rule and keeps earlier evidence bound to its rule version", async () => {
    const f = await fixture();
    await f.appoint();
    const record = f.record();
    const requirement = {
      id: "driver_license",
      version: 1,
      category: "driver_license",
      label: "CDL status",
      subjectKinds: ["driver"],
      jurisdiction: "federal",
      classification: "legal",
      effectiveFrom: "2026-01-01T00:00:00Z",
      effectiveUntil: null,
      applicability: { anyOf: [{ allOf: [] }] },
      renewalDays: null,
      dueSoonDays: 60,
      source: {
        url: "https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-383",
        section: "383.23",
      },
    };
    await expect(
      f.service.adoptFleetRequirement(f.dispatcher, {
        operationId: randomUUID(),
        expectedVersion: 0,
        requirement,
      }),
    ).rejects.toMatchObject({ status: 403 });
    const adopted = await f.service.adoptFleetRequirement(f.reviewer, {
      operationId: randomUUID(),
      expectedVersion: 0,
      requirement,
    });
    expect(adopted.source.reviewedByUserId).toBe(f.reviewer.userId);
    await f.service.saveFleetComplianceEvidence(f.driver, {
      operationId: randomUUID(),
      expectedVersion: 0,
      record,
    });
    await f.service.verifyFleetComplianceEvidence(f.reviewer, {
      operationId: randomUUID(),
      evidenceId: record.evidence.id,
      expectedVersion: 1,
      decision: "verified",
      source: f.source,
      reviewedAt: "2026-10-16T18:00:00Z",
    });
    const before = await f.service.assessFleetComplianceSubjects(f.dispatcher, {
      subjects: [record.evidence.subject],
    });
    expect(before.assessments[0].status).toBe("green");
    await f.service.adoptFleetRequirement(f.reviewer, {
      operationId: randomUUID(),
      expectedVersion: 1,
      requirement: { ...requirement, version: 2 },
    });
    const after = await f.service.assessFleetComplianceSubjects(f.dispatcher, {
      subjects: [record.evidence.subject],
    });
    expect(after.assessments[0].status).toBe("red");
    expect(after.assessments[0].ruleVersions).toContainEqual({
      id: "driver_license",
      version: 2,
    });
    expect(before.assessments[0].status).toBe("green");
  });
  it("preserves qualified source details privately without leaking them in ordinary projections", async () => {
    const f = await fixture();
    await f.appoint();
    const record = f.record();
    await f.service.saveFleetComplianceEvidence(f.driver, {
      operationId: randomUUID(),
      expectedVersion: 0,
      record,
    });
    await f.service.verifyFleetComplianceEvidence(f.reviewer, {
      operationId: randomUUID(),
      evidenceId: record.evidence.id,
      expectedVersion: 1,
      decision: "verified",
      source: f.source,
      reviewedAt: "2026-10-16T17:59:00Z",
    });
    const reviewed = await f.service.readPrivateComplianceRecord(
      f.reviewer,
      record.evidence.id,
    );
    expect((reviewed as unknown as { review: unknown }).review).toMatchObject({
      source: f.source,
      reviewerUserId: f.reviewer.userId,
      reviewedAt: "2026-10-16T18:00:00.000Z",
    });
  });
  it("requires explicit reviewer appointment, masks dispatch, and keeps raw fields out of ordinary audit and vendor JSON", async () => {
    const f = await fixture();
    const record = f.record();
    const input = { operationId: randomUUID(), expectedVersion: 0, record };
    const saved = await f.service.saveFleetComplianceEvidence(f.driver, input);
    expect(saved.revision).toBe(1);
    await expect(
      f.service.readPrivateComplianceRecord(f.admin, record.evidence.id),
    ).rejects.toMatchObject({ status: 403 });
    await f.appoint();
    expect(
      (
        await f.service.readPrivateComplianceRecord(
          f.reviewer,
          record.evidence.id,
        )
      ).attributes,
    ).toEqual(record.attributes);
    const page = await f.service.readFleetComplianceRegister(f.dispatcher, {});
    expect(page.entries[0]).toMatchObject({
      status: "red",
      verification: "document_received",
      maskedIdentifier: "••••6789",
    });
    expect(JSON.stringify(page)).not.toContain("PRIVATE-LICENSE");
    expect(
      await f.service.saveFleetComplianceEvidence(f.driver, input),
    ).toEqual(saved);
    const review = await f.service.verifyFleetComplianceEvidence(f.reviewer, {
      operationId: randomUUID(),
      evidenceId: record.evidence.id,
      expectedVersion: 1,
      decision: "verified",
      source: f.source,
      reviewedAt: "2026-10-16T17:59:00Z",
    });
    expect(review.revision).toBe(2);
    const privateRecord = await f.service.readPrivateComplianceRecord(
      f.reviewer,
      record.evidence.id,
    );
    expect(privateRecord.evidence.verifiedByUserId).toBe(f.reviewer.userId);
    const audit = await f.pool.query(
      "SELECT tool_input,tool_output FROM assistant_action_audit WHERE vendor_id=$1",
      [f.admin.companyId],
    );
    const vendor = await f.pool.query(
      "SELECT fleet_compliance_configuration FROM vendors WHERE id=$1",
      [f.admin.companyId],
    );
    const json = JSON.stringify([audit.rows, vendor.rows]);
    for (const secret of [
      "PRIVATE-LICENSE",
      "PRIVATE-REGISTRY",
      "licenseNumber",
      "queryReference",
    ])
      expect(json).not.toContain(secret);
  });
  it("prevents ordinary users from verifying or borrowing another driver's private record", async () => {
    const f = await fixture();
    const record = f.record();
    await f.service.saveFleetComplianceEvidence(f.driver, {
      operationId: randomUUID(),
      expectedVersion: 0,
      record,
    });
    await expect(
      f.service.verifyFleetComplianceEvidence(f.dispatcher, {
        operationId: randomUUID(),
        evidenceId: record.evidence.id,
        expectedVersion: 1,
        decision: "verified",
        source: f.source,
        reviewedAt: "2026-10-16T18:00:00Z",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.service.saveFleetComplianceEvidence(f.driver, {
        operationId: randomUUID(),
        expectedVersion: 0,
        record: {
          ...f.record(),
          evidence: {
            ...record.evidence,
            id: randomUUID(),
            subject: { kind: "driver", id: f.dispatcher.userId },
          },
        },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("cannot waive a revoked license or shorten a retained legal hold through a new upload", async () => {
    const f = await fixture();
    await f.appoint();
    const record = f.record();
    if (record.attributes.kind === "driver_license")
      record.attributes.licenseStatus = "revoked";
    await f.service.saveFleetComplianceEvidence(f.driver, {
      operationId: randomUUID(),
      expectedVersion: 0,
      record: {
        ...record,
        legalHold: true,
        retainUntil: "2030-01-01T00:00:00Z",
      },
    });
    await expect(
      f.service.verifyFleetComplianceEvidence(f.reviewer, {
        operationId: randomUUID(),
        evidenceId: record.evidence.id,
        expectedVersion: 1,
        decision: "verified",
        source: f.source,
        reviewedAt: "2026-10-16T18:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "fleet.credential_not_eligible" });
    await expect(
      f.service.saveFleetComplianceEvidence(f.driver, {
        operationId: randomUUID(),
        expectedVersion: 1,
        record: { ...record, evidence: { ...record.evidence, revision: 2 } },
      }),
    ).rejects.toMatchObject({ code: "fleet.retention_cannot_shorten" });
  });
  it("limits medical files and historical records to current designated reviewers, including exact retries", async () => {
    const f = await fixture();
    await f.appoint();
    const record = f.record("driver_medical");
    const file = await f.service.uploadComplianceDocument(f.driver, {
      operationId: randomUUID(),
      subject: record.evidence.subject,
      recordId: record.evidence.id,
      contentType: "application/pdf",
      bodyBase64: Buffer.from("%PDF- synthetic private medical").toString(
        "base64",
      ),
    });
    const input = {
      operationId: randomUUID(),
      expectedVersion: 0,
      record: {
        ...record,
        evidence: { ...record.evidence, privateDocumentRef: file.objectPath },
      },
    };
    await f.service.saveFleetComplianceEvidence(f.driver, input);
    await expect(
      f.service.readComplianceDocument(f.dispatcher, record.evidence.id),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (
        await f.service.readComplianceDocument(f.reviewer, record.evidence.id)
      ).body.toString(),
    ).toContain("synthetic private medical");
    await f.service.saveComplianceReviewers(f.admin, {
      operationId: randomUUID(),
      expectedVersion: (await f.service.complianceConfiguration(f.admin))
        .version,
      reviewerUserIds: [],
    });
    await expect(
      f.service.readPrivateComplianceRecord(f.reviewer, record.evidence.id, 1),
    ).rejects.toMatchObject({ status: 403 });
    await f.pool.query(
      "UPDATE users SET session_version=session_version+1 WHERE id=$1",
      [f.driver.userId],
    );
    await expect(
      f.service.saveFleetComplianceEvidence(f.driver, input),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("does not transfer a private document to a different subject before the first record save", async () => {
    const f = await fixture();
    const record = f.record();
    const file = await f.service.uploadComplianceDocument(f.driver, {
      operationId: randomUUID(),
      subject: record.evidence.subject,
      recordId: record.evidence.id,
      contentType: "application/pdf",
      bodyBase64: Buffer.from("%PDF- driver's own file").toString("base64"),
    });
    await expect(
      f.service.saveFleetComplianceEvidence(f.admin, {
        operationId: randomUUID(),
        expectedVersion: 0,
        record: {
          ...record,
          evidence: {
            ...record.evidence,
            subject: { kind: "driver", id: f.dispatcher.userId },
            privateDocumentRef: file.objectPath,
          },
        },
      }),
    ).rejects.toMatchObject({ code: "fleet.private_document_required" });
  });
  it("refuses private revision bytes that no longer match their immutable keyed identity", async () => {
    const f = await fixture();
    await f.appoint();
    const record = f.record();
    await f.service.saveFleetComplianceEvidence(f.driver, {
      operationId: randomUUID(),
      expectedVersion: 0,
      record,
    });
    const [path, object] = [...f.objects.entries()].find(
      ([path]) => !path.includes("/documents/"),
    )!;
    const altered = {
      ...record,
      attributes: { ...record.attributes, licenseNumber: "TAMPERED" },
    };
    f.objects.set(path, {
      ...object,
      body: Buffer.from(JSON.stringify(altered)),
    });
    await expect(
      f.service.readPrivateComplianceRecord(f.reviewer, record.evidence.id),
    ).rejects.toMatchObject({ code: "fleet.private_record_unavailable" });
  });
});
