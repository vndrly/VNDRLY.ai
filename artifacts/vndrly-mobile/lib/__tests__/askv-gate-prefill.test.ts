import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("react-native", () => ({ Linking: { openURL: vi.fn() } }));
vi.mock("@/lib/api", () => ({ getApiBase: () => "https://vndrly.ai" }));
import { executeAskVClientIntent, subscribeAskVGatePrefill } from "../askv-client-tools";

beforeEach(() => vi.clearAllMocks());
describe("AskV Gate client bridge", () => {
  it("delivers only validated Gate draft fields to the visible screen", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAskVGatePrefill(listener);
    const result = await executeAskVClientIntent({
      name: "prefill_gate_visit",
      arguments: { mode: "check-in", values: { firstName: "Bob", vehiclePlate: "8TRK22", submitted: true }, missing: ["plateState"] },
    }, "/gate");
    expect(result).toMatchObject({ ok: true, saved: false });
    expect(listener).toHaveBeenCalledWith({
      mode: "check-in", values: { firstName: "Bob", vehiclePlate: "8TRK22" }, matches: [], missing: ["plateState"],
    });
    unsubscribe();
  });
});
