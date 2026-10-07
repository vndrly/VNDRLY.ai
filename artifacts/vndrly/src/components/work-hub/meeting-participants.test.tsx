import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MeetingParticipants } from "./meeting-participants";
import en from "@/lib/locales/en.json";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/work-hub-client", () => ({ workHubRequest: mocks.request }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => (en.meetingParticipants as Record<string, string>)[key.split(".")[1]], i18n: { language: "en" } }),
}));
vi.mock("@/components/brand-pill-button", () => ({
  default: ({ children, tone: _tone, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
beforeEach(() => {
  cleanup();
  mocks.request.mockReset();
});
it("selects only current company names and returns canonical IDs", async () => {
  mocks.request.mockResolvedValue([
    { id: 12, displayName: "Joe", sameCompany: true },
    { id: 99, displayName: "Foreign coworker", sameCompany: false },
  ]);
  const change = vi.fn(),
    ready = vi.fn();
  render(
    <MeetingParticipants
      identity="9:company1"
      selected={[]}
      onChange={change}
      onReady={ready}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Joe" }));
  expect(change).toHaveBeenLastCalledWith([12]);
  expect(screen.queryByText("Foreign coworker")).toBeNull();
  expect(screen.queryByLabelText("Participant user IDs")).toBeNull();
  expect(ready).toHaveBeenLastCalledWith(true);
});
it("clears selection and refuses stale company response after identity changes", async () => {
  let resolve!: (value: unknown) => void;
  mocks.request
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValueOnce([
      { id: 22, displayName: "Current company", sameCompany: true },
    ]);
  const change = vi.fn(),
    ready = vi.fn();
  const view = render(
    <MeetingParticipants
      identity="old"
      selected={[12]}
      onChange={change}
      onReady={ready}
    />,
  );
  view.rerender(
    <MeetingParticipants
      identity="new"
      selected={[]}
      onChange={change}
      onReady={ready}
    />,
  );
  await screen.findByText("Current company");
  resolve([{ id: 12, displayName: "Previous company", sameCompany: true }]);
  await waitFor(() =>
    expect(screen.queryByText("Previous company")).toBeNull(),
  );
  expect(change).toHaveBeenCalledWith([]);
});
it("denied or malformed directory never enables scheduling", async () => {
  mocks.request.mockRejectedValue(Error("denied"));
  const ready = vi.fn();
  render(
    <MeetingParticipants
      identity="denied"
      selected={[]}
      onChange={vi.fn()}
      onReady={ready}
    />,
  );
  await screen.findByRole("alert");
  expect(ready).toHaveBeenLastCalledWith(false);
  expect(screen.queryByRole("button")).toBeNull();
});
