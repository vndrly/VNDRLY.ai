import { describe, expect, it } from "vitest";
import {
  chatGptActionTools,
  chatGptReadableTools,
} from "../chatgpt-tool-access";
import { toolsForRealtime } from "../tool-packs";
import { workspaceRequest, workspaceOutput } from "../chatgpt-workspace";

// Deterministic tool-contract eval: no live model, account, or database mutation.
describe("marketplace tool-use scenarios", () => {
  const vendor = {
    userId: 7,
    role: "vendor",
    vendorId: 3,
    membershipRole: "admin",
    activeMembershipId: 4,
  };
  it("finds partner demand from catalog context and keeps comparison out of vendor tools", () => {
    const reads = chatGptReadableTools(vendor, ["marketplace:read"]).map(
      (x) => x.name,
    );
    expect(reads).toContain("query_marketplace_demand");
    expect(reads).not.toContain("compare_marketplace_vendors");
    expect(
      toolsForRealtime({ ...vendor, path: "/service-marketplace" }).map(
        (x) => x.name,
      ),
    ).toContain("query_marketplace_demand");
  });
  it("requires separate write consent and excludes field employees", () => {
    expect(chatGptActionTools(vendor, ["marketplace:read"])).toEqual([]);
    expect(
      chatGptActionTools(vendor, ["marketplace:write"]).map((x) => x.name),
    ).toContain("confirm_marketplace_job_offer_action");
    expect(
      chatGptReadableTools({ ...vendor, role: "field_employee" }, [
        "marketplace:read",
      ]),
    ).toEqual([]);
    expect(
      chatGptActionTools({ ...vendor, role: "field_employee" }, [
        "marketplace:write",
      ]),
    ).toEqual([]);
    expect(
      chatGptReadableTools(
        {
          userId: 8,
          role: "partner",
          partnerId: 9,
          membershipRole: "member",
          activeMembershipId: 5,
        },
        ["marketplace:read"],
      ).map((x) => x.name),
    ).toContain("compare_marketplace_vendors");
  });
  it("renders the existing workspace from a permission-scoped marketplace source", () => {
    const source = workspaceRequest({ view: "marketplace" });
    expect(source.sourceTool).toBe("search_marketplace_services");
    const result = workspaceOutput(
      source.view,
      source.sourceTool,
      {},
      {
        items: [
          {
            partnerName: "Flywheel",
            name: "Gatekeeping",
            eligibility: {
              eligible: false,
              reasonCodes: ["OUT_OF_SERVICE_AREA"],
            },
          },
        ],
      },
    );
    expect(result.sections[0].rows[0]).toMatchObject({
      title: "Gatekeeping",
      detail: expect.stringContaining("Flywheel"),
    });
    expect(result.attention[0].attention).toContain("OUT_OF_SERVICE_AREA");
  });
});
