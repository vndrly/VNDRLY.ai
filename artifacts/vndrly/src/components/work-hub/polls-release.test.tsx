import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ api: {} as any, send: vi.fn(), retry: vi.fn() }));
vi.mock("./form-campaigns/use-campaign", () => ({ useCampaign: () => mock.api }));
vi.mock("./form-campaigns", () => ({ OwnerProgress: () => <div>Manage poll</div>, EmployeeForm: () => <div>Vote</div> }));
vi.mock("@/components/brand-pill-button", () => ({ default: ({ tone, ...props }: any) => <button {...props} /> }));
import { NewPoll, PollWorkspace } from "./polls";
const id = "00000000-0000-4000-8000-000000000001";
function mount() { const done = vi.fn(); render(<QueryClientProvider client={new QueryClient()}><NewPoll onCreated={done} /></QueryClientProvider>); return done; }
function fill() { fireEvent.change(screen.getByLabelText("Poll title"), { target: { value: "Lunch" } }); fireEvent.change(screen.getByLabelText("Poll question"), { target: { value: "Which lunch?" } }); }
beforeEach(() => {
  mock.send.mockReset(); mock.retry.mockReset();
  mock.api = { user: { role: "vendor", membershipRole: "admin" }, data: { people: [{ userId: 9, name: "Mock Person", role: "member" }] }, query: { isPending: false, isError: false }, mutation: { isPending: false }, uncertain: false, sendAsync: mock.send, retryAsync: mock.retry };
  mock.send.mockResolvedValue({ resource: { campaignId: id, state: { version: 1 } } });
});
it("creates and publishes selected recipients with the chosen expiration", async () => {
  const done = mount(); fill();
  fireEvent.change(screen.getByLabelText("Who should be notified"), { target: { value: "selected" } });
  fireEvent.click(screen.getByLabelText("Mock Person"));
  fireEvent.change(screen.getByLabelText("Poll expiration"), { target: { value: "8" } });
  fireEvent.click(screen.getByRole("button", { name: "Start Poll" }));
  await waitFor(() => expect(done).toHaveBeenCalledWith(id));
  expect(mock.send).toHaveBeenNthCalledWith(1, expect.objectContaining({ path: "/form-campaigns", payload: expect.objectContaining({ question: "Which lunch?", durationHours: 8, audience: { mode: "selected", userIds: [9], rolling: false } }) }));
  expect(mock.send).toHaveBeenNthCalledWith(2, { path: `/form-campaigns/${id}/publish`, payload: {}, version: 1 });
});
it("rejects a missing question and empty selected audience before writing", async () => {
  mount(); fireEvent.change(screen.getByLabelText("Poll title"), { target: { value: "Lunch" } });
  fireEvent.click(screen.getByRole("button", { name: "Start Poll" }));
  expect(await screen.findByRole("alert")).toBeTruthy(); expect(mock.send).not.toHaveBeenCalled();
  fill(); fireEvent.change(screen.getByLabelText("Who should be notified"), { target: { value: "selected" } });
  fireEvent.click(screen.getByRole("button", { name: "Start Poll" }));
  expect(mock.send).not.toHaveBeenCalled();
});
it("does not report success when publication fails", async () => {
  mock.send.mockResolvedValueOnce({ resource: { campaignId: id, state: { version: 1 } } }).mockRejectedValueOnce(Error("Unavailable"));
  const done = mount(); fill(); fireEvent.click(screen.getByRole("button", { name: "Start Poll" }));
  await screen.findByText("Unavailable"); expect(done).not.toHaveBeenCalled();
});
it("hides poll creation from ordinary members", () => {
  mock.api.user.membershipRole = "member"; mount(); expect(screen.queryByRole("button", { name: "Start Poll" })).toBeNull();
});
it("shows a vote only for assigned participants and management only to managers", () => {
  const { rerender } = render(<PollWorkspace poll={{ campaignId: id, title: "Lunch", kind: "poll", state: {} as any, canManage: false, instanceId: null, completed: false }} />);
  expect(screen.queryByText("Vote")).toBeNull(); expect(screen.queryByText("Manage poll")).toBeNull();
  rerender(<PollWorkspace poll={{ campaignId: id, title: "Lunch", kind: "poll", state: {} as any, canManage: true, instanceId: id, completed: false }} />);
  expect(screen.getByText("Vote")).toBeTruthy(); expect(screen.getByText("Manage poll")).toBeTruthy();
});
