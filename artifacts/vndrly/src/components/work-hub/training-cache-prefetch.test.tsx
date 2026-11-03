import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  fetchQuery: vi.fn(), prefetchQuery: vi.fn(),
  user: { userId: 7, activeMembershipId: 11, vendorId: 2 as number | null, partnerId: null, role: "vendor", offlineOnly: false, requiresContextChoice: false, mustChangePassword: false },
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => state }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: state.user, isLoading: false }) }));
vi.mock("@/lib/training-progress-query", () => ({ trainingProgressOptions: (user: typeof state.user) => ({ queryKey: ["training-progress", user.userId, user.activeMembershipId, "vendor", user.vendorId] }) }));
import TrainingCachePrefetch from "./training-cache-prefetch";
beforeEach(() => {
  state.user = { userId: 7, activeMembershipId: 11, vendorId: 2, partnerId: null, role: "vendor", offlineOnly: false, requiresContextChoice: false, mustChangePassword: false };
  state.fetchQuery.mockReset().mockResolvedValue({ certifications: [], canViewTeamTraining: false });
  state.prefetchQuery.mockReset().mockResolvedValue(undefined);
  window.history.replaceState({}, "", "/work-hub?progressMethod=cache");
});
it.each(["offlineOnly", "requiresContextChoice", "mustChangePassword"] as const)("does not prefetch while %s blocks the canonical session", flag => {
  state.user[flag] = true;
  render(<TrainingCachePrefetch />);
  expect(state.fetchQuery).not.toHaveBeenCalled();
  expect(state.prefetchQuery).not.toHaveBeenCalled();
});
it("does not prefetch without an organization", () => {
  state.user.vendorId = null;
  render(<TrainingCachePrefetch />);
  expect(state.fetchQuery).not.toHaveBeenCalled();
  expect(state.prefetchQuery).not.toHaveBeenCalled();
});
it("does not let a late old-company response start team reads in a new context", async () => {
  let resolveOld!: (value: { canViewTeamTraining: boolean }) => void;
  state.fetchQuery.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
  const view = render(<TrainingCachePrefetch />);
  state.user = { ...state.user, vendorId: 3, activeMembershipId: 12 };
  view.rerender(<TrainingCachePrefetch />);
  resolveOld({ canViewTeamTraining: true });
  await waitFor(() => expect(state.fetchQuery).toHaveBeenCalledTimes(2));
  await Promise.resolve();
  expect(state.prefetchQuery.mock.calls.every(([options]) => options.queryKey[1] === "safety-summary")).toBe(true);
  expect(state.fetchQuery.mock.calls[1][0].queryKey).toEqual(["training-progress", 7, 12, "vendor", 3]);
});
afterEach(cleanup);
it("keeps the baseline free of speculative data requests", () => {
  window.history.replaceState({}, "", "/work-hub?progressMethod=baseline");
  render(<TrainingCachePrefetch />);
  expect(state.fetchQuery).not.toHaveBeenCalled();
  expect(state.prefetchQuery).not.toHaveBeenCalled();
});
it("prefetches by default without a comparison selector", async () => {
  window.history.replaceState({}, "", "/work-hub");
  render(<TrainingCachePrefetch />);
  await waitFor(() => expect(state.fetchQuery).toHaveBeenCalledOnce());
  expect(state.prefetchQuery).toHaveBeenCalledOnce();
});
it("does not infer team access from the user's account role", async () => {
  render(<TrainingCachePrefetch />);
  await waitFor(() => expect(state.fetchQuery).toHaveBeenCalledOnce());
  expect(state.prefetchQuery.mock.calls.map(([options]) => options.queryKey[1])).toEqual(["safety-summary"]);
});
it("starts the normal administrator team read without waiting behind home requests", () => {
  Object.assign(state.user, { availableMemberships: [{ id: 11, role: "admin" }] });
  window.history.replaceState({}, "", "/work-hub");
  state.fetchQuery.mockReturnValue(new Promise(() => {}));
  render(<TrainingCachePrefetch />);
  expect(state.prefetchQuery.mock.calls.map(([options]) => options.queryKey[1])).toEqual(["team", "safety-summary"]);
});
it("retains serial team loading in the isolated cache comparison", () => {
  Object.assign(state.user, { availableMemberships: [{ id: 11, role: "admin" }] });
  state.fetchQuery.mockReturnValue(new Promise(() => {}));
  render(<TrainingCachePrefetch />);
  expect(state.prefetchQuery.mock.calls.map(([options]) => options.queryKey[1])).toEqual(["safety-summary"]);
});
it("prefetches team data only after the server grants access with the same identity key", async () => {
  state.fetchQuery.mockResolvedValue({ certifications: [], canViewTeamTraining: true });
  render(<TrainingCachePrefetch />);
  await waitFor(() => expect(state.prefetchQuery).toHaveBeenCalledTimes(2));
  expect(state.prefetchQuery.mock.calls[1][0].queryKey).toEqual(["training-progress", "team", 7, 11, "vendor", 2]);
  expect(state.prefetchQuery.mock.calls[1][0].staleTime).toBe(15_000);
});
