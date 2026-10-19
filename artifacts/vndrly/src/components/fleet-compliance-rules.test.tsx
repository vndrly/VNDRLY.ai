import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FleetComplianceRules } from "./fleet-compliance-rules";
import { draftFleetRequirement } from "@workspace/api-zod";
const api = vi.hoisted(() => ({
  complianceRequirements: vi.fn(),
  adoptComplianceRequirement: vi.fn(),
}));
vi.mock("@/lib/fleet-client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fleetClient: api,
}));
vi.mock("./png-pill-rollover", () => ({
  PngPillButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("revises an adopted custom identifier without truncating its namespace", async () => {
  const draft = draftFleetRequirement("driver-license", {
    version: 1,
    effectiveFrom: "2026-10-16T12:00:00Z",
  });
  api.complianceRequirements.mockResolvedValue({
    requirements: [
      {
        ...draft,
        id: "synthetic:license",
        label: "Saved driver requirement",
        source: {
          ...draft.source,
          reviewedAt: "2026-10-16T12:00:00Z",
          reviewedByUserId: 7,
        },
      },
    ],
    canAdopt: true,
    mode: "warn_only",
  });
  render(
    <FleetComplianceRules
      identity="company7"
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(await screen.findByLabelText("Requirement reference"), {
    target: { value: "saved:synthetic:license" },
  });
  expect(screen.getByLabelText("Requirement label").getAttribute("value")).toBe(
    "Saved driver requirement",
  );
});
it("keeps rule adoption restricted to appointed reviewers and draws no private records", async () => {
  api.complianceRequirements.mockResolvedValue({
    requirements: [],
    canAdopt: false,
    mode: "warn_only",
  });
  render(
    <FleetComplianceRules
      identity="company7"
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(await screen.findByText(/No adopted requirements/)).toBeTruthy();
  expect(screen.queryByLabelText("Requirement reference")).toBeNull();
  expect(api.adoptComplianceRequirement).not.toHaveBeenCalled();
});
it("prepares a reviewed reference and retries the same command until its exact canonical revision is read", async () => {
  const saved = vi.fn();
  let body: any,
    reads = 0;
  api.complianceRequirements.mockImplementation(async () => {
    if (!body) return { requirements: [], canAdopt: true, mode: "warn_only" };
    if (++reads === 1) throw new Error("Lost readback");
    return {
      requirements: [
        {
          ...body.requirement,
          source: {
            ...body.requirement.source,
            reviewedAt: "2026-10-16T22:00:00Z",
            reviewedByUserId: 7,
          },
        },
      ],
      canAdopt: true,
      mode: "warn_only",
    };
  });
  api.adoptComplianceRequirement.mockImplementation(async (input) => {
    body = input;
    return {
      ...input.requirement,
      source: {
        ...input.requirement.source,
        reviewedAt: "2026-10-16T22:00:00Z",
        reviewedByUserId: 7,
      },
    };
  });
  render(
    <FleetComplianceRules
      identity="company7"
      onSaved={saved}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(await screen.findByLabelText("Requirement reference"), {
    target: { value: "reference:tx-carrier-registration" },
  });
  expect(
    screen.getByRole("link", { name: /Official source/ }).getAttribute("href"),
  ).toBe("https://www.txdmv.gov/motor-carriers/txdmv-number");
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "I reviewed the source, scope and exceptions",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Prepare requirement revision" }),
  );
  expect(api.adoptComplianceRequirement).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Adopt requirement revision" }),
  );
  await screen.findByText(/Requirement save needs verification/);
  expect(saved).not.toHaveBeenCalled();
  const first = structuredClone(body);
  fireEvent.click(
    screen.getByRole("button", { name: "Retry the same requirement revision" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(api.adoptComplianceRequirement.mock.calls[1][0]).toEqual(first);
  expect(body.expectedVersion).toBe(0);
  expect(body.requirement.source).not.toHaveProperty("reviewedByUserId");
  expect(await screen.findByText(/Revision 1/)).toBeTruthy();
});

it("edits exact coverage requirements in the actual adoption form without changing prior rule revisions",async()=>{
 const original={...draftFleetRequirement("driver-license",{version:1,effectiveFrom:"2026-10-16T12:00:00Z"}),id:"policy-rule",label:"Scoped insurance",category:"insurance",subjectKinds:["carrier"],coverage:{coverageType:"cargo",requiredLimitUSD:"50000",filingRequired:false}};
 api.complianceRequirements.mockResolvedValue({requirements:[{...original,source:{...original.source,reviewedAt:"2026-10-16T12:00:00Z",reviewedByUserId:7}}],canAdopt:true,mode:"warn_only"});render(<FleetComplianceRules identity="company7" onSaved={vi.fn()} onClose={vi.fn()}/>);fireEvent.change(await screen.findByLabelText("Requirement reference"),{target:{value:"saved:policy-rule"}});expect((screen.getByLabelText("Exact minimum limit (USD)") as HTMLInputElement).value).toBe("50000");fireEvent.change(screen.getByLabelText("Exact minimum limit (USD)"),{target:{value:"75000.000000001"}});expect(original.coverage.requiredLimitUSD).toBe("50000");fireEvent.click(screen.getByRole("checkbox",{name:"I reviewed the source, scope and exceptions"}));fireEvent.click(screen.getByRole("button",{name:"Prepare requirement revision"}));api.adoptComplianceRequirement.mockRejectedValue(new Error("Synthetic response unavailable"));fireEvent.click(screen.getByRole("button",{name:"Adopt requirement revision"}));await waitFor(()=>expect(api.adoptComplianceRequirement).toHaveBeenCalledOnce());expect(api.adoptComplianceRequirement.mock.calls[0][0].requirement.coverage).toEqual({coverageType:"cargo",requiredLimitUSD:"75000.000000001",filingRequired:false});
});
