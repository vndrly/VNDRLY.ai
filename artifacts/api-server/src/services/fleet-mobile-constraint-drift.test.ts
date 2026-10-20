import { describe, expect, it } from "vitest";
import { filterEquivalentFleetConstraintDrift } from "../../../../lib/db/src/scripts/fleet-constraint-drift";

describe("Fleet constraint drift reconciliation", () => {
  it("suppresses only Fleet constraint recreation when live definitions are equivalent", async () => {
    const statements = [
      'ALTER TABLE "fleet_yard_orders" DROP CONSTRAINT "fleet_yard_orders_yard_fk";',
      'ALTER TABLE "fleet_yard_orders" ADD CONSTRAINT "fleet_yard_orders_yard_fk" FOREIGN KEY ("company_id","yard_id") REFERENCES "public"."fleet_yards"("company_id","id") ON DELETE no action ON UPDATE no action;',
      'ALTER TABLE "fleet_yard_orders" DROP CONSTRAINT "fleet_yard_orders_requester_fk";',
      'ALTER TABLE "fleet_yard_orders" ADD CONSTRAINT "fleet_yard_orders_requester_fk" FOREIGN KEY ("requested_by_user_id","company_id") REFERENCES "public"."user_org_memberships"("user_id","vendor_id") ON DELETE no action ON UPDATE no action;',
      'ALTER TABLE "vendors" DROP CONSTRAINT "some_vendor_fk";',
      'ALTER TABLE "fleet_person_capabilities" DROP CONSTRAINT "fleet_person_capabilities_member_fk";',
      'ALTER TABLE "fleet_person_capabilities" ADD CONSTRAINT "fleet_person_capabilities_member_fk" FOREIGN KEY ("user_id","company_id") REFERENCES "public"."user_org_memberships"("user_id","vendor_id") ON DELETE cascade ON UPDATE no action;',
    ];
    const result = await filterEquivalentFleetConstraintDrift(statements, async (_table, name) => {
      if (name === "fleet_yard_orders_yard_fk")
        return "FOREIGN KEY (company_id, yard_id) REFERENCES fleet_yards(company_id, id)";
      if (name === "fleet_yard_orders_requester_fk")
        return "FOREIGN KEY (requested_by_user_id, company_id) REFERENCES users(id, id)";
      if (name === "fleet_person_capabilities_member_fk")
        return "FOREIGN KEY (user_id, company_id) REFERENCES user_org_memberships(user_id, vendor_id) ON DELETE CASCADE";
      return null;
    });
    expect(result).toEqual(statements.slice(2, 5));
  });
});
