import React from "react";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import FleetComplianceRules from "./FleetComplianceRules";
import { draftFleetRequirement } from "@workspace/api-zod";
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => true,
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    text: "white",
    card: "gray",
    primary: "gold",
    destructive: "red",
  }),
}));
vi.mock("./TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("./FleetChoiceField", () => ({
  default: ({ label, value, onChange, options, disabled }: any) => (
    <select
      disabled={disabled}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Choose</option>
      {options.map((row: any) => (
        <option key={row.id} value={row.id}>
          {row.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
afterEach(() => {
  cleanup();
  mocks.api.mockReset();
});
it("keeps the complete saved requirement identity when preparing a native revision", async () => {
  const draft = draftFleetRequirement("driver-license", {
    version: 1,
    effectiveFrom: "2026-10-16T12:00:00Z",
  });
  mocks.api.mockResolvedValue({
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
  render(<FleetComplianceRules onSaved={vi.fn()} onClose={vi.fn()} />);
  fireEvent.change(await screen.findByLabelText("Requirement reference"), {
    target: { value: "saved:synthetic:license" },
  });
  expect(screen.getByDisplayValue("Saved driver requirement")).toBeTruthy();
});
it("shows only safe rule history to ordinary staff and does not expose adoption", async () => {
  mocks.api.mockResolvedValue({
    requirements: [],
    canAdopt: false,
    mode: "warn_only",
  });
  render(<FleetComplianceRules onSaved={vi.fn()} onClose={vi.fn()} />);
  expect(await screen.findByText(/No adopted requirements/)).toBeTruthy();
  expect(screen.queryByLabelText("Requirement reference")).toBeNull();
  expect(
    mocks.api.mock.calls.every(
      (call) => call[0] === "/api/fleet/compliance/requirements",
    ),
  ).toBe(true);
});
it("retains exact native adoption identity through uncertain readback before reporting success", async () => {
  let body: any,
    reads = 0;
  const saved = vi.fn(),
    sent: unknown[] = [];
  mocks.api.mockImplementation(async (_path: string, options: any) => {
    if (options?.method === "POST") {
      body = JSON.parse(options.body);
      sent.push(body);
      return {
        ...body.requirement,
        source: {
          ...body.requirement.source,
          reviewedAt: "2026-10-16T22:00:00Z",
          reviewedByUserId: 7,
        },
      };
    }
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
  render(<FleetComplianceRules onSaved={saved} onClose={vi.fn()} />);
  fireEvent.change(await screen.findByLabelText("Requirement reference"), {
    target: { value: "reference:tx-carrier-registration" },
  });
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "I reviewed the source, scope and exceptions",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Prepare requirement revision" }),
  );
  expect(sent).toHaveLength(0);
  fireEvent.click(
    screen.getByRole("button", { name: "Adopt requirement revision" }),
  );
  await screen.findByText(/Requirement save needs verification/);
  expect(saved).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry the same requirement revision" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(sent[1]).toEqual(sent[0]);
  expect(body.requirement.source).not.toHaveProperty("reviewedByUserId");
  expect(await screen.findByText(/Revision 1/)).toBeTruthy();
});
