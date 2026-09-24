import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../../../../lib/db/src/schema/notifications";
import { readFileSync } from "node:fs";

describe("additive gate alert storage", () => {
  it("defaults SMS off with nullable consent and email on", () => {
    const columns = getTableConfig(schema.notificationPreferencesTable).columns;
    expect(columns.find(c => c.name === "alerts_sms_enabled")?.default).toBe(false);
    expect(columns.find(c => c.name === "alerts_email_enabled")?.default).toBe(true);
    expect(columns.find(c => c.name === "alerts_sms_opted_in_at")?.notNull).toBe(false);
    expect(columns.some(c => c.name === "alerts_sms_consent_fingerprint")).toBe(true);
  });
  it("stores unique channel attempts without sensitive delivery payloads", () => {
    const table = getTableConfig(schema.notificationChannelDeliveriesTable);
    expect(table.columns.map(c => c.name)).toEqual(expect.arrayContaining(["notification_id", "channel", "attempt_token", "attempt_count", "provider_message_id", "last_error_code", "delivered_at"]));
    expect(table.columns.map(c => c.name)).not.toEqual(expect.arrayContaining(["phone", "email", "body", "payload"]));
    expect(table.indexes.filter(i => i.config.unique)).toHaveLength(2);
    expect(table.foreignKeys[0].onDelete).toBe("cascade");
  });
  it("registers only guarded additive migration statements in deployment", () => {
    const source = readFileSync(new URL("../../scripts/migrate-gate-alert-channels.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(DROP|TRUNCATE|DELETE FROM|UPDATE notification)\b/);
    expect(source.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(7);
    expect(source).toContain("CREATE TABLE IF NOT EXISTS notification_push_deliveries");
    const push = getTableConfig(schema.notificationPushDeliveriesTable);
    expect(push.columns.map(c => c.name)).toContain("destination_hash");
    expect(push.columns.map(c => c.name)).not.toContain("token");
    expect(push.indexes[0].config.unique).toBe(true);
    expect(push.indexes.map(index => index.config.name)).toEqual(expect.arrayContaining(["notification_push_stale_idx", "notification_push_cleanup_idx"]));
    expect(source).toContain("CREATE INDEX IF NOT EXISTS notification_push_stale_idx");
    expect(source).toContain("CREATE INDEX IF NOT EXISTS notification_push_cleanup_idx");
    expect(getTableConfig(schema.notificationsTable).columns.find(c => c.name === "urgent_delivery_pending")?.default).toBe(false);
    expect(source).toContain("CREATE TABLE IF NOT EXISTS notification_channel_deliveries");
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(pkg.scripts["migrate:gate-alert-channels"]).toBe("tsx scripts/migrate-gate-alert-channels.ts");
    expect(readFileSync(new URL("../../../../.github/workflows/deploy-api.yml", import.meta.url), "utf8")).toContain("run migrate:gate-alert-channels");
  });
});
