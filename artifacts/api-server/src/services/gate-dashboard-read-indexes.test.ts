import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { assistantActionAuditTable } from "../../../../lib/db/src/schema/assistantActionAudit";
import { siteVisitsTable } from "../../../../lib/db/src/schema/siteVisits";
import { ticketCheckInsTable } from "../../../../lib/db/src/schema/ticketCheckIns";
import { ticketStatusHistoryTable } from "../../../../lib/db/src/schema/ticketStatusHistory";
import { workHubTaskEventsTable } from "../../../../lib/db/src/schema/workHubWork";

const names = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).indexes.map(index => index.config.name);

describe("Gate dashboard read indexes", () => {
  it("keeps every high-volume dashboard lookup indexed and additively replayable", () => {
    expect(names(siteVisitsTable)).toContain("site_visits_site_checkin_idx");
    expect(names(ticketCheckInsTable)).toEqual(expect.arrayContaining([
      "ticket_check_ins_ticket_time_idx",
      "ticket_check_ins_gate_time_idx",
    ]));
    expect(names(ticketStatusHistoryTable)).toContain("ticket_status_history_ticket_status_time_idx");
    expect(names(workHubTaskEventsTable)).toContain("work_hub_task_events_task_type_time_idx");
    expect(names(assistantActionAuditTable)).toContain("assistant_action_audit_vendor_target_idx");

    const migration = readFileSync(new URL("../../../../lib/db/drizzle/gate_change_over.sql", import.meta.url), "utf8");
    for (const name of [
      "site_visits_site_checkin_idx",
      "ticket_check_ins_ticket_time_idx",
      "ticket_check_ins_gate_time_idx",
      "ticket_status_history_ticket_status_time_idx",
      "work_hub_task_events_task_type_time_idx",
      "assistant_action_audit_vendor_target_idx",
    ]) expect(migration).toContain(`CREATE INDEX IF NOT EXISTS ${name}`);
  });
});
