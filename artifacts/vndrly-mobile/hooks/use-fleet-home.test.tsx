import React from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useFleetHome } from "./use-fleet-home";

const mocks = vi.hoisted(() => ({ api: vi.fn(), get: vi.fn(), set: vi.fn(), userId: 7, companyId: 3 }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: mocks.userId }, activeMembershipId: 9, activeMembership: { orgId: mocks.companyId } }) }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: mocks.get, setItem: mocks.set } }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: 1 }), isAuthScopeCurrent: () => true }));
afterEach(() => { cleanup(); mocks.api.mockReset(); mocks.get.mockReset(); mocks.set.mockReset(); mocks.userId = 7; mocks.companyId = 3; });

it("reads only the current membership's Fleet Home and visibility", async () => {
  mocks.get.mockResolvedValue(JSON.stringify({ map: false }));
  mocks.api.mockResolvedValue({ module: "summary", state: "ready", data: { companyId: 3, userId: 7, mode: "coordinated", capabilities: ["admin"], nextAction: null, priorities: [], warnings: [], moduleStates: [] } });
  const { result } = renderHook(() => useFleetHome());
  await waitFor(() => expect(result.current.projection?.companyId).toBe(3));
  expect(mocks.api).toHaveBeenCalledWith("/api/fleet/home?module=summary", {}, { generation: 1 });
  expect(mocks.get).toHaveBeenCalledWith("fleet-home-visibility:3:7:9");
  expect(result.current.visibility).toEqual({ map: false });
});

it("does not display another account's projection", async () => {
  mocks.get.mockResolvedValue(null);
  mocks.api.mockResolvedValue({ module: "summary", state: "ready", data: { companyId: 4, userId: 7, mode: "coordinated", capabilities: ["admin"], nextAction: null, priorities: [], warnings: [], moduleStates: [] } });
  const { result } = renderHook(() => useFleetHome());
  await waitFor(() => expect(result.current.state).toBe("unavailable"));
  expect(result.current.projection).toBeNull();
});
