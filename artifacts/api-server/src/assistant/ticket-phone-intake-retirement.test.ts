import { expect, it } from "vitest";
import { TICKET_WORKFLOW_TOOLS } from "./ticket-workflow-tools";
it("does not advertise retired phone intake fields through Ask V", () => {
  const tool = TICKET_WORKFLOW_TOOLS.find(tool => tool.name === "manage_ticket_record");
  const schema = JSON.stringify(tool?.inputSchema);
  expect(schema).not.toContain("phoneIntakeCallerName");
  expect(schema).not.toContain("acceptanceImplicit");
  expect(schema).not.toContain("office_on_behalf_of_partner");
  expect(schema).toContain("siteLocationId");
});
