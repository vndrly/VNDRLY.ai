import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ request: vi.fn(), userId: 7 }));
vi.mock("./repository-client", () => ({ useRepository: () => ({ user: { userId: state.userId, activeMembershipId: 9 }, owner: { type: "vendor", id: 1 } }) }));
vi.mock("@/lib/work-hub-client", async original => ({ ...await original<any>(), workHubRequest: state.request }));
vi.mock("@/components/brand-pill-button", () => ({ default: ({ children, tone: _tone, ...props }: any) => <button {...props}>{children}</button> }));
import TrainingMessageButton from "./training-message-button";
function mount() { return render(<QueryClientProvider client={new QueryClient()}><TrainingMessageButton person={{ userId: 8, name: "Alex" }} /></QueryClientProvider>); }
beforeEach(() => { state.userId = 7; state.request.mockReset(); state.request.mockImplementation(async (path, init) => path === "/chats" ? { channel: { id: "pair-chat" } } : { operationId: JSON.parse(init.body).operationId }); });
afterEach(cleanup);
it("opens a draft without sending, then submits to the pair chat", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Message Alex about training" }));
  expect(state.request).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "How is your training progressing?" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  expect(await screen.findByText("Message sent.")).toBeTruthy();
  expect(state.request.mock.calls[0][0]).toBe("/chats");
  expect(JSON.parse(state.request.mock.calls[0][1].body)).toEqual({ recipientUserId: 8 });
  expect(JSON.parse(state.request.mock.calls[1][1].body).payload.body).toBe("How is your training progressing?");
  expect(screen.getByRole("link", { name: "Open chat" }).getAttribute("href")).toBe("/work-hub/chat?channel=pair-chat");
});
it("reuses the original message operation when delivery is uncertain", async () => {
  let sends = 0;
  state.request.mockImplementation(async (path, init) => {
    if (path === "/chats") return { channel: { id: "pair-chat" } };
    if (++sends === 1) throw Error("Unconfirmed delivery");
    return { operationId: JSON.parse(init.body).operationId };
  });
  mount(); fireEvent.click(screen.getByRole("button", { name: "Message Alex about training" }));
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Please check your training." } });
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry Submit" }));
  await screen.findByText("Message sent.");
  const sendsOnly = state.request.mock.calls.filter(([path]) => path.includes("/messages"));
  expect(JSON.parse(sendsOnly[0][1].body).operationId).toBe(JSON.parse(sendsOnly[1][1].body).operationId);
  expect(state.request.mock.calls.filter(([path]) => path === "/chats")).toHaveLength(1);
});
it("does not send after the active account changes while opening a chat", async () => {
  let finish!: (result: unknown) => void;
  state.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = mount(); fireEvent.click(screen.getByRole("button", { name: "Message Alex about training" }));
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Training follow-up" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(1));
  state.userId = 10;
  view.rerender(<QueryClientProvider client={new QueryClient()}><TrainingMessageButton person={{ userId: 8, name: "Alex" }} /></QueryClientProvider>);
  await act(async () => { finish({ channel: { id: "pair-chat" } }); });
  expect(state.request).toHaveBeenCalledTimes(1);
});
