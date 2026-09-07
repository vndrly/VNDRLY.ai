import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAssistant } from "./use-assistant";
import { useOnboardingProgress } from "./use-onboarding-progress";

const mocks = vi.hoisted(() => ({ getMine: vi.fn() }));
vi.mock("@/lib/onboarding-api", () => ({ onboardingApi: { getMine: mocks.getMine } }));
afterEach(() => vi.unstubAllGlobals());

it("refreshes local onboarding progress when a typed assistant stream reports a committed onboarding action", async () => {
  mocks.getMine.mockResolvedValue({ progress: { currentStep: "rates" } });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).endsWith("/conversations")) return new Response(JSON.stringify({ id: 8 }), { status: 200 });
    return new Response('event: mutation\ndata: {"mutation":{"name":"complete_onboarding_step","refresh":["onboarding"]}}\n\nevent: done\ndata: {}\n\n', { status: 200 });
  }));
  const { result } = renderHook(() => ({ assistant: useAssistant(), onboarding: useOnboardingProgress() }));
  await waitFor(() => expect(result.current.onboarding.progress?.currentStep).toBe("rates"));
  mocks.getMine.mockResolvedValue({ progress: { currentStep: "first-employee" } });
  await act(async () => { await result.current.assistant.send("Yes."); });
  await waitFor(() => expect(result.current.onboarding.progress?.currentStep).toBe("first-employee"));
});
