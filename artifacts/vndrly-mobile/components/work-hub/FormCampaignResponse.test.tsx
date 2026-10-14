import en from "@/lib/locales/en.json";
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
const m = vi.hoisted(() => ({ data: null as any, send: vi.fn() }));
vi.mock("@/lib/use-form-campaigns", () => ({
  useFormCampaigns: () => ({
    data: m.data,
    send: m.send,
    contextKey: "one",
    busy: false,
    uncertain: false,
  }),
}));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({}),
  isAuthScopeCurrent: () => true,
}));
vi.mock("@/lib/meeting-files", () => ({
  downloadAndShareProtectedFile: vi.fn(),
}));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({}) }));
vi.mock("../TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("react-native", () => ({
  View: ({ children }: any) => <div>{children}</div>,
  Text: ({ children }: any) => <span>{children}</span>,
  TextInput: ({ accessibilityLabel, onChangeText, value }: any) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
  Switch: ({ accessibilityLabel, value, onValueChange, disabled }: any) => (
    <input
      type="checkbox"
      aria-label={accessibilityLabel}
      checked={value}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.checked)}
    />
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key.split(".").reduce((value: any, k) => value?.[k], en) ?? key,
  }),
}));
import Form from "./FormCampaignResponse";
afterEach(() => {
  cleanup();
  m.send.mockReset();
});
function setup(kind = "acknowledgement") {
  m.data = {
    config: {
      kind,
      title: "Security",
      description: "",
      policyText: "Approved policy",
      policyVersion: "2",
      timezone: "America/Chicago",
      choices: [{ id: "a", label: "Park" }],
      maxSelections: 1,
    },
    state: { deadline: "2099-01-01T00:00:00Z" },
    canSubmit: true,
    version: 0,
    response: null,
    definition: [],
    totals: null,
  };
  m.send.mockResolvedValue({
    resource: { submittedAt: "2026-10-14T00:00:00Z" },
  });
}
it("opening a policy does not acknowledge it; explicit checkbox submits exact response", async () => {
  setup();
  render(<Form instanceId="assigned" />);
  expect(m.send).not.toHaveBeenCalled();
  expect(
    (screen.getByText("Submit acknowledgement") as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByLabelText("I acknowledge this policy"));
  fireEvent.click(screen.getByText("Submit acknowledgement"));
  await waitFor(() =>
    expect(m.send).toHaveBeenCalledWith(
      "/api/work-hub/form-campaigns/instances/assigned/respond",
      { acknowledged: true },
      0,
    ),
  );
});
it("does not offer submission for a closed poll", () => {
  setup("poll");
  m.data.state.deadline = "2000-01-01T00:00:00Z";
  render(<Form instanceId="assigned" />);
  expect(screen.getByText("Voting closed")).toBeTruthy();
  expect(screen.queryByText("Submit vote")).toBeNull();
  expect(m.send).not.toHaveBeenCalled();
});
it("renders and submits reusable form fields", async () => {
  setup("form");
  m.data.definition = [
    { id: "note", label: "Inspection", type: "text", required: true },
  ];
  render(<Form instanceId="assigned" />);
  fireEvent.change(screen.getByLabelText("Inspection"), {
    target: { value: "Ready" },
  });
  fireEvent.click(screen.getByText("Submit form"));
  await waitFor(() =>
    expect(m.send).toHaveBeenCalledWith(
      expect.any(String),
      { values: { note: "Ready" } },
      0,
    ),
  );
});
