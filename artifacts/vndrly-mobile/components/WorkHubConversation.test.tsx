vi.mock("./WorkHubMessageReactions", () => ({ default: () => null }));
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ api: vi.fn(), generation: 1, user: { id: 7, vendorId: 9, activeMembershipId: 10 }, confirm: null as null | (() => void) }));
vi.mock("@/lib/api", () => ({ apiFetch: env.api }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: env.generation }), isAuthScopeCurrent: (scope: any) => scope.generation === env.generation }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: env.user }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({}) }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: async () => null, setItem: async () => undefined } }));
vi.mock("@/lib/work-hub-queue-runtime", () => ({ isOfflineWorkHubFailure: () => false, queueNativeWorkHubRequest: vi.fn() }));
vi.mock("react-native", () => ({
  View: ({ children }: any) => <div>{children}</div>, Text: ({ children }: any) => <span>{children}</span>,
  Pressable: ({ children, onPress, disabled }: any) => <button onClick={onPress} disabled={disabled}>{children}</button>,
  TextInput: ({ value, onChangeText, accessibilityLabel, editable }: any) => <input aria-label={accessibilityLabel} value={value} disabled={editable === false} onChange={e => onChangeText(e.target.value)} />,
  Alert: { alert: (_title: string, _body: string, buttons: any[]) => { env.confirm = buttons[1].onPress; } },
}));
import WorkHubConversation from "./WorkHubConversation";
const channel = { id: "channel-a", name: "Synthetic", ownerOrgType: "vendor", ownerOrgId: 9 };
const message = { id: "message-a", body: "Original", version: 1, authorUserId: 7, createdAt: "2026-10-07T00:00:00Z" };
const receipt = (options: any) => {
  const request = JSON.parse(options.body);
  return { operationId: request.operationId, resource: { ...message, channelId: channel.id, body: options.method === "DELETE" ? "" : request.payload.body, version: (request.expectedVersion ?? 0) + 1, deletedAt: options.method === "DELETE" ? "2026-10-07T01:00:00Z" : null } };
};
beforeEach(() => { env.generation = 1; env.user = { id: 7, vendorId: 9, activeMembershipId: 10 }; env.api.mockReset(); env.api.mockImplementation(async (_path, options) => options?.method ? {} : [message]); });
afterEach(cleanup);
it("retries an uncertain edit with the original target, version, body and UUID", async () => {
  let refused = false;
  env.api.mockImplementation(async (_path, options) => { if (options?.method === "PATCH" && !refused) { refused = true; throw new Error("Dropped response"); } return options?.method === "PATCH" ? receipt(options) : options?.method ? {} : [message]; });
  render(<WorkHubConversation channel={channel} onClose={() => {}} />);
  fireEvent.click(await screen.findByText("Edit"));
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Reviewed edit" } });
  fireEvent.click(screen.getByText("Save edit"));
  fireEvent.click(await screen.findByText("Retry original request"));
  await waitFor(() => expect(env.api.mock.calls.filter(c => c[1]?.method === "PATCH")).toHaveLength(2));
  const calls = env.api.mock.calls.filter(c => c[1]?.method === "PATCH");
  expect(calls[1]).toEqual(calls[0]);
  expect(JSON.parse(calls[0][1].body)).toMatchObject({ expectedVersion: 1, payload: { body: "Reviewed edit" } });
  expect(calls[0][0]).toBe("/api/work-hub/channels/channel-a/messages/message-a");
});
it("retries a delete with the original UUID rather than a second delete intent", async () => {
  let refused = false;
  env.api.mockImplementation(async (_path, options) => { if (options?.method === "DELETE" && !refused) { refused = true; throw new Error("Dropped response"); } return options?.method === "DELETE" ? receipt(options) : options?.method ? {} : [message]; });
  render(<WorkHubConversation channel={channel} onClose={() => {}} />);
  fireEvent.click(await screen.findByText("Delete"));
  act(() => env.confirm?.());
  fireEvent.click(await screen.findByText("Retry original request"));
  await waitFor(() => expect(env.api.mock.calls.filter(c => c[1]?.method === "DELETE")).toHaveLength(2));
  const calls = env.api.mock.calls.filter(c => c[1]?.method === "DELETE");
  expect(calls[1]).toEqual(calls[0]);
});
it("fences a delayed old account read and resets pending identity on channel switch", async () => {
  let finish!: (rows: any[]) => void;
  env.api.mockImplementation((path, options) => path.includes("channel-a/messages") && !options?.method ? new Promise(resolve => { finish = resolve; }) : Promise.resolve([]));
  const view = render(<WorkHubConversation channel={channel} onClose={() => {}} />);
  env.generation++;
  env.user = { id: 8, vendorId: 11, activeMembershipId: 12 };
  view.rerender(<WorkHubConversation channel={{ ...channel, id: "channel-b" }} onClose={() => {}} />);
  await act(async () => finish([message]));
  expect(screen.queryByText("Original")).toBeNull();
  expect(env.api.mock.calls.some(c => c[0].includes("channel-a/read-cursor"))).toBe(false);
});
it("retains original edit when a success response does not match its saved operation", async () => {
  env.api.mockImplementation(async (_path, options) => options?.method === "PATCH" ? { ...receipt(options), operationId: "unrelated-operation" } : options?.method ? {} : [message]);
  render(<WorkHubConversation channel={channel} onClose={() => {}} />);
  fireEvent.click(await screen.findByText("Edit"));
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Reviewed edit" } });
  fireEvent.click(screen.getByText("Save edit"));
  expect(await screen.findByText("Retry original request")).toBeTruthy();
  expect((screen.getByLabelText("Message") as HTMLInputElement).value).toBe("Reviewed edit");
  fireEvent.click(screen.getByText("Retry original request"));
  await waitFor(() => expect(env.api.mock.calls.filter(c => c[1]?.method === "PATCH")).toHaveLength(2));
  const calls = env.api.mock.calls.filter(c => c[1]?.method === "PATCH");
  expect(calls[1]).toEqual(calls[0]);
});
it("retains the exact unresolved operation when retry authority is denied", async () => {
  let attempts = 0;
  env.api.mockImplementation(async (_path, options) => {
    if (options?.method === "PATCH") {
      attempts++;
      if (attempts === 1) throw new Error("Dropped accepted response");
      if (attempts === 2) throw Object.assign(new Error("Current access revoked"), { status: 403 });
      return receipt(options);
    }
    return options?.method ? {} : [message];
  });
  render(<WorkHubConversation channel={channel} onClose={() => {}} />);
  fireEvent.click(await screen.findByText("Edit"));
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Reviewed edit" } });
  fireEvent.click(screen.getByText("Save edit"));
  fireEvent.click(await screen.findByText("Retry original request"));
  await waitFor(() => expect(env.api.mock.calls.filter(c => c[1]?.method === "PATCH")).toHaveLength(2));
  expect(screen.getByText("Retry original request")).toBeTruthy();
  expect((screen.getByLabelText("Message") as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByText("Retry original request"));
  await waitFor(() => expect(env.api.mock.calls.filter(c => c[1]?.method === "PATCH")).toHaveLength(3));
  const calls = env.api.mock.calls.filter(c => c[1]?.method === "PATCH");
  expect(calls[1]).toEqual(calls[0]);
  expect(calls[2]).toEqual(calls[0]);
});
