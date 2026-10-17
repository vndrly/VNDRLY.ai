import React from "react";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import FleetComplianceFacts from "./FleetComplianceFacts";
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
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("./FleetChoiceField", () => ({
  default: ({ label, value, onChange, options, disabled }: any) => (
    <select
      disabled={disabled}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Unknown</option>
      {options.map((option: any) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
afterEach(() => {
  cleanup();
  mocks.api.mockReset();
});
it("shows only authorized operational facts, leaving unknown facts unknown and suppressing edits for a non-reviewer", async () => {
  mocks.api.mockImplementation(async (path: string) =>
    path.endsWith("/requirements")
      ? { requirements: [], canAdopt: false, mode: "warn_only" }
      : {
          subject: { kind: "driver", id: 7 },
          version: 1,
          facts: { cdlRequired: null },
          reviewedAt: "2026-10-16T18:00:00Z",
          reviewedByUserId: 2,
          sourceKind: "government_registry",
        },
  );
  render(
    <FleetComplianceFacts
      subject={{ kind: "driver", id: 7 }}
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  const cdl = await screen.findByLabelText("CDL required for this work");
  expect((cdl as HTMLSelectElement).value).toBe("");
  expect((cdl as HTMLSelectElement).disabled).toBe(true);
  expect(screen.queryByText("Prepare applicability facts")).toBeNull();
  expect(
    mocks.api.mock.calls.some((call) => /private|documents/.test(call[0])),
  ).toBe(false);
});
it("preserves exact native applicability and original revision identity through an uncertain canonical readback", async () => {
  const subject = { kind: "driver" as const, id: 7 },
    sent: any[] = [],
    saved = vi.fn();
  let body: any,
    reads = 0;
  mocks.api.mockImplementation(async (path: string, options: any) => {
    if (path.endsWith("/requirements"))
      return { requirements: [], canAdopt: true, mode: "warn_only" };
    if (options?.method === "POST") {
      body = JSON.parse(options.body);
      sent.push(body);
      return { version: 1 };
    }
    if (!path.includes("?revision=")) return null;
    if (++reads === 1) throw new Error("Lost readback");
    return {
      subject,
      version: 1,
      facts: body.facts,
      reviewedAt: "2026-10-16T18:00:00Z",
      reviewedByUserId: 2,
      sourceKind: body.source.kind,
    };
  });
  render(
    <FleetComplianceFacts
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
    target: { value: "Source #7" },
  });
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "I reviewed these facts against this source",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Prepare applicability facts" }),
  );
  expect(sent).toHaveLength(0);
  fireEvent.click(
    screen.getByRole("button", { name: "Save applicability facts" }),
  );
  await screen.findByText(/Applicability save needs verification/);
  expect(saved).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry the same applicability facts" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(sent[1]).toEqual(sent[0]);
  expect(sent[0].facts).toEqual({ cdlRequired: true });
});
