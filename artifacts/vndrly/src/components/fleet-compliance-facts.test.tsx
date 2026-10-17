import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import { FleetComplianceFactsEditor } from "./fleet-compliance-facts";
const api = vi.hoisted(() => ({
  complianceFacts: vi.fn(),
  complianceRequirements: vi.fn(),
  saveComplianceFacts: vi.fn(),
}));
vi.mock("@/lib/fleet-client", () => ({ fleetClient: api }));
vi.mock("./png-pill-rollover", () => ({
  PngPillButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("keeps applicability unknown until sourced review and reconciles the exact saved fact revision after a lost readback", async () => {
  const subject = { kind: "driver" as const, id: 7 };
  let body: any;
  const saved = vi.fn();
  api.complianceRequirements.mockResolvedValue({
    requirements: [],
    canAdopt: true,
    mode: "warn_only",
  });
  api.complianceFacts
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(new Error("Lost readback"))
    .mockImplementation(async () => ({
      subject,
      version: 1,
      facts: body.facts,
      reviewedAt: "2026-10-16T18:00:00Z",
      reviewedByUserId: 2,
      sourceKind: body.source.kind,
    }));
  api.saveComplianceFacts.mockImplementation(async (input) => {
    body = input;
    return { version: 1 };
  });
  render(
    <FleetComplianceFactsEditor
      identity="company7"
      subject={subject}
      onSaved={saved}
      onClose={vi.fn()}
    />,
  );
  const cdl = await screen.findByLabelText("CDL required for this work");
  expect((cdl as HTMLSelectElement).value).toBe("");
  fireEvent.change(cdl, { target: { value: "yes" } });
  fireEvent.change(screen.getByLabelText("Verification source"), {
    target: { value: "government_registry" },
  });
  fireEvent.change(screen.getByLabelText("Source reference"), {
    target: { value: "Classification review #1" },
  });
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "I reviewed these facts against this source",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Prepare applicability facts" }),
  );
  expect(api.saveComplianceFacts).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Save applicability facts" }),
  );
  await screen.findByText(/Applicability save needs verification/);
  expect(saved).not.toHaveBeenCalled();
  const first = structuredClone(body);
  fireEvent.click(
    screen.getByRole("button", { name: "Retry the same applicability facts" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(api.saveComplianceFacts.mock.calls[1][0]).toEqual(first);
  expect(api.complianceFacts).toHaveBeenLastCalledWith(subject, 1);
  expect(first.facts).toEqual({ cdlRequired: true });
  expect(first).not.toHaveProperty("medicalDiagnosis");
});
