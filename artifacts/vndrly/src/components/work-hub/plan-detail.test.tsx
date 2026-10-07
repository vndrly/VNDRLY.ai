import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
vi.mock("@/components/brand-pill-button", () => ({ default: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button> }));
import { WorkPlanDetail } from "./plan-detail";
afterEach(() => vi.unstubAllGlobals());
const taskId = "11111111-1111-4111-8111-111111111111";
const projection = { taskId, taskVersion: 3, verifiedCompletionStepIds: [], eligibleStepIds: [], overdueStepIds: ["review"], executionStarted: false, backgroundExecutionAvailable: false, plan: { steps: [{ id: "review", specialist: "Finn", state: "completed", dependsOn: [], deadlineAt: "2030-01-01T12:00:00Z", completion: { kind: "planned_read_observed" } }] } };
function show() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WorkPlanDetail taskId={taskId} taskVersion={3} identity="17:vendor:4" /></QueryClientProvider>); }
it("fetches exact authorized detail only on request and distinguishes unverified completion", async () => {
 const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => projection }); vi.stubGlobal("fetch", fetch);
 show(); expect(fetch).not.toHaveBeenCalled(); fireEvent.click(screen.getByText("View saved plan"));
 expect(await screen.findByText("Recorded completion has no verified evidence.")).toBeTruthy();
 expect(screen.getByText(/Read observations only/)).toBeTruthy();
 expect(fetch.mock.calls[0][0]).toBe(`/api/work-hub/tasks/${taskId}/plan`);
 expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: "include", cache: "no-store" });
});
it("refuses changed task version rather than presenting cached verified status", async () => {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...projection, taskVersion: 4, verifiedCompletionStepIds: ["review"] }) }));
 show(); fireEvent.click(screen.getAllByText("View saved plan").at(-1)!);
 expect((await screen.findByRole("alert")).textContent).toContain("The plan changed");
});
