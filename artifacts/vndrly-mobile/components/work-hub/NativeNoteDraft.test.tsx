import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({
  scan: vi.fn(),
  summary: vi.fn(),
  current: true,
  changed: null as (() => void) | null,
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  View: ({ children }: any) => <div>{children}</div>,
  Text: ({ children }: any) => <span>{children}</span>,
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, disabled, onPress }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "black" }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => env.current,
  subscribeToken: (fn: () => void) => {
    env.changed = fn;
    return () => {};
  },
  subscribeUser: () => () => {},
}));
vi.mock("@/lib/native-work-capture", () => ({
  scanWorkTextDraft: env.scan,
  summarizeWorkDraft: env.summary,
}));
import NativeNoteDraft from "./NativeNoteDraft";
beforeEach(() => {
  env.current = true;
  env.scan.mockReset();
  env.summary.mockReset();
});
afterEach(cleanup);
describe("review native note drafts", () => {
  it("requires explicit use before replacing note text", async () => {
    env.scan.mockResolvedValue({ text: "Scanned text", truncated: false });
    const change = vi.fn();
    render(
      <NativeNoteDraft
        value="Original"
        disabled={false}
        onChange={change}
        onBusy={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("nativeWorkDraft.scan"));
    await screen.findByText("Scanned text");
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("nativeWorkDraft.useDraft"));
    expect(change).toHaveBeenCalledWith("Scanned text");
  });
  it("drops a proposal when the original note changes", async () => {
    env.summary.mockResolvedValue({ text: "Summary" });
    const props = { disabled: false, onChange: vi.fn(), onBusy: vi.fn() };
    const view = render(<NativeNoteDraft value="Original" {...props} />);
    fireEvent.click(screen.getByText("nativeWorkDraft.summary"));
    await screen.findByText("Summary");
    view.rerender(<NativeNoteDraft value="Edited by user" {...props} />);
    expect(screen.queryByText("Summary")).toBeNull();
  });
  it("refuses late results after an account switch", async () => {
    env.scan.mockImplementation(async () => {
      env.current = false;
      return { text: "Old account", truncated: false };
    });
    const busy = vi.fn();
    render(
      <NativeNoteDraft
        value="Original"
        disabled={false}
        onChange={vi.fn()}
        onBusy={busy}
      />,
    );
    fireEvent.click(screen.getByText("nativeWorkDraft.scan"));
    await waitFor(() => expect(busy).toHaveBeenLastCalledWith(false));
    expect(screen.queryByText("Old account")).toBeNull();
  });
  it("refuses an old draft after edits change and return to the same original text", async () => {
    let resolve!: (value: { text: string }) => void;
    env.summary.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const props = { disabled: false, onChange: vi.fn(), onBusy: vi.fn() };
    const view = render(<NativeNoteDraft value="Original" {...props} />);
    fireEvent.click(screen.getByText("nativeWorkDraft.summary"));
    expect((screen.getByText("nativeWorkDraft.summary") as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<NativeNoteDraft value="Edited" {...props} />);
    view.rerender(<NativeNoteDraft value="Original" {...props} />);
    resolve({ text: "Stale summary" });
    await waitFor(() => expect(props.onBusy).toHaveBeenLastCalledWith(false));
    expect(screen.queryByText("Stale summary")).toBeNull();
    expect(props.onChange).not.toHaveBeenCalled();
  });
  it("blocks duplicate requests before any asynchronous result", async () => {
    let resolve!: (value: { text: string; truncated: boolean }) => void;
    env.scan.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const busy = vi.fn();
    render(
      <NativeNoteDraft
        value="Original"
        disabled={false}
        onChange={vi.fn()}
        onBusy={busy}
      />,
    );
    const button = screen.getByText("nativeWorkDraft.scan");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(env.scan).toHaveBeenCalledTimes(1);
    resolve({ text: "Draft", truncated: false });
    await screen.findByText("Draft");
  });
  it("leaves the note untouched when the device feature is unavailable", async () => {
    env.summary.mockRejectedValue(new Error("unavailable"));
    const change = vi.fn();
    render(
      <NativeNoteDraft
        value="Original"
        disabled={false}
        onChange={change}
        onBusy={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("nativeWorkDraft.summary"));
    await screen.findByText("nativeWorkDraft.unavailable");
    expect(change).not.toHaveBeenCalled();
  });
});
