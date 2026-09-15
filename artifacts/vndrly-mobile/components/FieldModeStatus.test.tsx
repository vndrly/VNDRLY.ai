import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/lib/locales/en.json";
import FieldModeStatus from "./FieldModeStatus";
import type { FieldModeSnapshot } from "@/lib/field-mode-policy";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({ lng: "en", fallbackLng: "en", resources: { en: { translation: en } }, interpolation: { escapeValue: false }, react: { useSuspense: false } });
});
afterEach(cleanup);

const snapshot = (mode: FieldModeSnapshot["mode"]): FieldModeSnapshot => ({ mode, presence: "on_site", consented: true, scheduled: true, expectsMoreWork: true, shiftEndsAtMs: null, stoppedOffsiteAtMs: null, promptStartedAtMs: null, lastEventId: null });

describe("FieldModeStatus", () => {
  it("is hidden when work is inactive", () => {
    const { container } = render(<FieldModeStatus snapshot={snapshot("off")} onEndWork={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows visible work tracking and an accessible end-work action", () => {
    const onEndWork = vi.fn();
    render(<FieldModeStatus snapshot={snapshot("active")} onEndWork={onEndWork} />);
    expect(screen.getByText("V is ready · Work location on")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "End work" }));
    expect(onEndWork).toHaveBeenCalledTimes(1);
  });
});
