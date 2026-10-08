import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ api: vi.fn(), confirm: null as null | (() => void) }));
vi.mock("react-native", () => ({
  View: ({ children }: any) => <div>{children}</div>, Text: ({ children }: any) => <span>{children}</span>,
  TextInput: ({ value, onChangeText, editable, accessibilityLabel }: any) => <input aria-label={accessibilityLabel} value={value} disabled={!editable} onChange={event => onChangeText(event.target.value)} />,
  Alert: { alert: (_title: string, _message: string, buttons: any[]) => { env.confirm = buttons[1].onPress; } },
}));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, disabled, onPress }: any) => <button disabled={disabled} onClick={onPress}>{children}</button> }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "black" }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/api", () => ({ apiFetch: env.api }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: 1 }), isAuthScopeCurrent: () => true }));
vi.mock("@/lib/native-uuid", () => ({ nativeUuid: () => "original-operation" }));
import NativeShiftResponse from "./NativeShiftResponse";
beforeEach(() => { env.api.mockReset(); env.confirm = null; }); afterEach(cleanup);
it("requires a reviewed reason and explicit confirmation, then retains the exact failed response for retry", async () => {
  env.api.mockRejectedValueOnce(Error("lost response")).mockResolvedValue({ operationId: "original-operation", shiftId: "own-shift", status: "declined" });
  render(<NativeShiftResponse shiftId="own-shift" />);
  expect((screen.getByText("nativeShiftResponse.decline") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("nativeShiftResponse.reason"), { target: { value: "Unavailable" } });
  fireEvent.click(screen.getByText("nativeShiftResponse.decline")); expect(env.api).not.toHaveBeenCalled();
  env.confirm!(); await screen.findByText("nativeShiftResponse.failed");
  fireEvent.click(screen.getByText("nativeShiftResponse.retry")); await screen.findByText("nativeShiftResponse.saved");
  expect(env.api.mock.calls[0][0]).toBe("/api/native-operations/shifts/own-shift/respond");
  expect(env.api.mock.calls[1][1].body).toBe(env.api.mock.calls[0][1].body);
});
it("never reports saved for a mismatched canonical shift receipt", async () => {
  env.api.mockResolvedValue({ operationId: "original-operation", shiftId: "someone-else", status: "accepted" });
  render(<NativeShiftResponse shiftId="own-shift" />); fireEvent.click(screen.getByText("nativeShiftResponse.accept")); env.confirm!();
  await waitFor(() => expect(screen.queryByText("nativeShiftResponse.failed")).not.toBeNull()); expect(screen.queryByText("nativeShiftResponse.saved")).toBeNull();
});
