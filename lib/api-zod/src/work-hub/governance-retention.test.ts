import { describe, expect, it } from "vitest";
import {
  legalHoldCreateSchema,
  legalHoldReleaseSchema,
  retentionMinimumCreateSchema,
  retentionPolicyCreateSchema,
  workHubGovernanceOwnerSchema,
} from "./governance-retention";

const rules = {
  messages: 30,
  deleted_messages: 30,
  files_voice_notes: 30,
  notes_versions: 30,
  form_submissions: 30,
  meeting_recordings: 30,
  transcripts: 30,
  attendance: 30,
  external_calendar_cache: 30,
  audit_logs: 30,
};

describe("Work Hub retention administration contracts", () => {
  it("rejects owner ids outside the canonical database integer range", () => {
    expect(() =>
      workHubGovernanceOwnerSchema.parse({
        type: "vendor",
        id: 2_147_483_648,
      }),
    ).toThrow();
  });

  it("requires complete explicit policy rules and an operation id", () => {
    expect(
      retentionPolicyCreateSchema.parse({
        operationId: "11111111-1111-4111-8111-111111111111",
        owner: { type: "vendor", id: 9 },
        rules,
      }).rules,
    ).toEqual(rules);
    expect(() =>
      retentionPolicyCreateSchema.parse({
        operationId: "11111111-1111-4111-8111-111111111111",
        owner: { type: "vendor", id: 9 },
        rules: { messages: 30 },
      }),
    ).toThrow();
  });

  it("keeps platform minimum creation ownerless and strict", () => {
    expect(
      retentionMinimumCreateSchema.parse({
        operationId: "11111111-1111-4111-8111-111111111111",
        rules,
      }).rules,
    ).toEqual(rules);
    expect(() =>
      retentionMinimumCreateSchema.parse({
        operationId: "11111111-1111-4111-8111-111111111111",
        owner: { type: "vendor", id: 9 },
        rules,
      }),
    ).toThrow();
  });

  it("accepts only canonical hold subjects and bounded reasons", () => {
    expect(
      legalHoldCreateSchema.parse({
        operationId: "11111111-1111-4111-8111-111111111111",
        owner: { type: "partner", id: 4 },
        subject: {
          type: "meeting_occurrence",
          id: "22222222-2222-4222-8222-222222222222",
        },
        reason: "Litigation preservation",
      }).subject.type,
    ).toBe("meeting_occurrence");
    expect(() =>
      legalHoldCreateSchema.parse({
        operationId: "11111111-1111-4111-8111-111111111111",
        owner: { type: "partner", id: 4 },
        subject: { type: "person", id: "4" },
        reason: "x",
      }),
    ).toThrow();
    expect(() =>
      legalHoldCreateSchema.parse({
        operationId: "11111111-1111-4111-8111-111111111111",
        owner: { type: "partner", id: 4 },
        subject: { type: "organization", id: "04" },
        reason: "x",
      }),
    ).toThrow();
    expect(() =>
      legalHoldCreateSchema.parse({
        operationId: "11111111-1111-4111-8111-111111111111",
        owner: { type: "partner", id: 4 },
        subject: { type: "channel", id: "not-a-uuid" },
        reason: "x",
      }),
    ).toThrow();
    expect(() =>
      legalHoldCreateSchema.parse({
        operationId: "11111111-1111-4111-8111-111111111111",
        owner: { type: "partner", id: 4 },
        subject: { type: "meeting_occurrence", id: "4" },
        reason: "x",
      }),
    ).toThrow();
    expect(() =>
      legalHoldCreateSchema.parse({
        operationId: "11111111-1111-4111-8111-111111111111",
        owner: { type: "partner", id: 4 },
        subject: { type: "organization", id: "vendor:9" },
        reason: "x".repeat(1001),
      }),
    ).toThrow();
  });

  it("requires exact ids for hold release", () => {
    expect(
      legalHoldReleaseSchema.parse({
        operationId: "11111111-1111-4111-8111-111111111111",
        holdId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toBeTruthy();
    expect(() =>
      legalHoldReleaseSchema.parse({ operationId: "bad", holdId: "bad" }),
    ).toThrow();
  });
});
