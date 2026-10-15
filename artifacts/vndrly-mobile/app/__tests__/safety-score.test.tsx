import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
const m = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), canGoBack: () => true, error: false }));
vi.mock("expo-router", () => ({ router: m, Stack: { Screen: () => null } }));
vi.mock("react-native", () => ({ View: ({ children }: any) => <div>{children}</div>, Text: ({ children }: any) => <span>{children}</span>, ScrollView: ({ children }: any) => <div>{children}</div> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({}) }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "teal" }) }));
vi.mock("@/components/InPageHeader", () => ({ default: () => null }));
vi.mock("@/components/LayeredPillButton", () => ({ default: ({ onPress, children }: any) => <button onClick={onPress}>{children}</button> }));
vi.mock("@/lib/safety-api", () => ({ fetchSafetyMetrics: vi.fn(), fetchSafetyTrainingStatus: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: ({ queryKey }: any) => queryKey[0] === "safety-metrics" ? { data: { safetyScore: 82, openEventCount: 2, openHipoCount: 1 } } : m.error ? { isError: true } : { data: { allComplete: false, incompleteModules: [{ id: 1, title: "Required hazard training" }] } } }));
import SafetyScore from "../safety-score";
afterEach(() => { cleanup(); vi.clearAllMocks(); m.error = false; });
it("shows company score separately from real training requirements and links to actions", () => {
 render(<SafetyScore />);
 expect(screen.getByText("82 / 100")).toBeTruthy();
 expect(screen.getByText(/Required hazard training/)).toBeTruthy();
 for (const [label, path] of [["training", "/safety-training"], ["assignments", "/work-hub/tasks-forms"], ["certifications", "/compliance"], ["reviewEvents", "/safety-my-reports"]]) {
  fireEvent.click(screen.getByText(`safety.scoreDetails.${label}`)); expect(m.push).toHaveBeenLastCalledWith(path);
 }
});
it("does not claim requirements are complete when training fails to load", () => {
 m.error = true; render(<SafetyScore />);
 expect(screen.getByText("safety.scoreDetails.unavailable")).toBeTruthy();
 expect(screen.queryByText("safety.trainingAllComplete")).toBeNull();
});

