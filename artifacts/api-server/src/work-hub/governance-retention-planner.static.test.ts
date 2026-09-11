import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const planner = readFileSync(new URL("./governance-retention-planner.ts", import.meta.url), "utf8");
const runtime = readFileSync(new URL("./governance-retention-planner-runtime.ts", import.meta.url), "utf8");
const retentionRuntime = readFileSync(new URL("./governance-retention-runtime.ts", import.meta.url), "utf8");
const serverIndex = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

describe("retention planner destructive-operation guard", () => {
  it("contains no content or object deletion primitive", () => {
    for (const source of [planner, runtime]) {
      expect(source).not.toMatch(/\bdeleteObject\s*\(/i);
      expect(source).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA|DATABASE))\b/i);
      expect(source).not.toMatch(/\.delete\s*\(/);
    }
  });
  it("uses bounded stable candidate reads and current versions at publication", () => {
    expect(runtime).toContain("RETENTION_PLAN_CHUNK_LIMIT");
    expect(runtime).toContain('ORDER BY "candidateTime" ASC, "candidateId" ASC');
    expect(runtime).toContain("policyVersion: input.policyVersion");
    expect(runtime).toContain("minimumPolicyVersion: input.minimumPolicyVersion");
    expect(runtime).toContain("retentionHoldFingerprint(context.holds) !== input.activeHoldFingerprint");
    expect(runtime).toContain("retention.plan.completed");
  });
  it("covers message metadata and owner-scoped audit/dependency references", () => {
    expect(runtime).toContain("work_hub_message_metadata");
    expect(runtime).toMatch(/work_hub_audit_log[\s\S]*owner_org_type[\s\S]*owner_org_id/);
    expect(runtime).toContain("work_hub_acknowledgements");
    expect(runtime).toContain("work_hub_approval_requests");
    expect(runtime).toContain("work_hub_form_submissions child");
    expect(runtime).toMatch(/work_hub_messages child JOIN work_hub_channels child_channel[\s\S]*child_channel\.owner_org_type/);
    expect(runtime).toMatch(/work_hub_read_cursors x JOIN work_hub_channels cursor_channel[\s\S]*cursor_channel\.owner_org_id/);
    expect(runtime).toMatch(/work_hub_form_submissions child JOIN work_hub_form_instances child_instance[\s\S]*work_hub_form_templates child_template[\s\S]*child_template\.owner_org_type/);
  });
  it("classifies file, form and meeting channel ownership drift as unknown instead of filtering it out", () => {
    expect(runtime).toMatch(/case "files_voice_notes"[\s\S]*c\.id IS NULL OR c\.owner_org_type<>/);
    expect(runtime).toMatch(/case "form_submissions"[\s\S]*c\.id IS NULL OR c\.owner_org_type<>/);
    for (const retentionClass of ["meeting_recordings", "transcripts", "attendance"]) {
      expect(runtime).toMatch(new RegExp(`case "${retentionClass}"[\\s\\S]*c\\.id IS NULL OR c\\.owner_org_type<>`));
    }
    expect(runtime).not.toContain("AND (f.channel_id IS NULL OR c.id IS NOT NULL)");
    expect(runtime).not.toContain("AND (i.channel_id IS NULL OR c.id IS NOT NULL)");
    expect(runtime).not.toContain("AND (m.channel_id IS NULL OR c.id IS NOT NULL)");
  });
  it("shares the documented governance lock between planner, policies, minimums and holds", () => {
    expect(runtime).toContain("acquireRetentionPublicationLocks");
    expect(retentionRuntime).toContain("acquireGlobalRetentionLock");
    expect(retentionRuntime.match(/acquireRetentionPublicationLocks\(tx, input\.owner\)/g)).toHaveLength(3);
    expect(retentionRuntime).not.toContain("await acquireOwnerGovernanceLock(tx, input.owner)");
  });
  it("awaits retention planner drain shutdown before completing server shutdown", () => {
    expect(serverIndex).toContain("async function shutdown");
    expect(serverIndex).toContain("const retentionPlannerStop = stopWorkHubRetentionPlannerWorker()");
    expect(serverIndex).toContain("await retentionPlannerStop");
    expect(serverIndex.indexOf("stopWorkHubRetentionPlannerWorker()")).toBeLessThan(serverIndex.indexOf("stopApprovalRecomputeWorker()"));
    expect(serverIndex.indexOf("await retentionPlannerStop")).toBeGreaterThan(serverIndex.indexOf("stopMajikEventBus()"));
    expect(serverIndex.indexOf("await retentionPlannerStop")).toBeLessThan(serverIndex.indexOf("completeServerShutdown({"));
  });
});
