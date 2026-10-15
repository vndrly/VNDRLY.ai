import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import { workHubCommandEnvelopeSchema } from "@workspace/api-zod";
const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "10000000-0000-4000-8000-000000000003",
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: 7, vendorId: 12, activeMembershipId: 15 } }),
}));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({}) }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => true,
}));
vi.mock("@/lib/api", () => ({ apiFetch: (...a: any[]) => m.api(...a) }));
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
  ScrollView: ({ children }: any) => <div>{children}</div>,
  Modal: ({ children, visible }: any) =>
    visible ? <div>{children}</div> : null,
  TextInput: ({ value, onChangeText, accessibilityLabel }: any) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));
vi.mock("./library/AssignmentReview", () => ({
  default: ({ kind }: any) => <div>Library assignment: {kind}</div>,
}));
import TaskAssignment from "./TaskAssignment";
afterEach(() => {
  cleanup();
  m.api.mockReset();
});
function setup() {
  m.api.mockImplementation(async (path: string, options: any) => {
    if (options?.method) {
      const e = workHubCommandEnvelopeSchema.parse(JSON.parse(options.body));
      return {
        operationId: e.operationId,
        resource: { id: "saved", assigneeUserId: 9 },
      };
    }
    return path.endsWith("/people")
      ? [
          { id: 9, displayName: "Casey", sameCompany: true },
          { id: 10, displayName: "Other company", sameCompany: false },
        ]
      : {
          forms: [
            {
              id: "form-1",
              name: "Site inspection",
              ownerOrgType: "vendor",
              ownerOrgId: 12,
            },
          ],
        };
  });
}
it("creates a valid task for the chosen colleague and reports saved state", async () => {
  setup();
  const saved = vi.fn(async () => {});
  render(<TaskAssignment onSaved={saved} />);
  fireEvent.click(screen.getByText("Create assignment"));
  fireEvent.click(await screen.findByText("Casey"));
  fireEvent.change(screen.getByLabelText("Task title"), {
    target: { value: "Inspect truck" },
  });
  fireEvent.click(screen.getByText("Assign"));
  await screen.findByText("Assignment saved.");
  expect(saved).toHaveBeenCalled();
  const call = m.api.mock.calls.find((c) => c[1]?.method);
  expect(call?.[0]).toBe("/api/work-hub/tasks");
  expect(JSON.parse(call![1].body)).toMatchObject({
    payloadVersion: 1,
    payload: { title: "Inspect truck", assigneeUserId: 9 },
  });
  expect(screen.queryByText("Other company")).toBeNull();
});
it("routes forms through the shared reviewed library assignment flow", async () => {
  setup();
  render(<TaskAssignment onSaved={async () => {}} />);
  fireEvent.click(screen.getByText("Create assignment"));
  await screen.findByText("Casey");
  fireEvent.click(screen.getByText("Form"));
  expect(screen.getByText("Library assignment: form")).toBeTruthy();
  expect(screen.queryByLabelText("Task title")).toBeNull();
});

it("offers all four assignment types from the existing create dialog", async () => {
  setup();
  render(<TaskAssignment onSaved={async () => {}} />);
  fireEvent.click(screen.getByText("Create assignment"));
  expect(screen.getByText("Policy Acknowledgment")).toBeTruthy();
  expect(screen.getByText("Training")).toBeTruthy();
});
