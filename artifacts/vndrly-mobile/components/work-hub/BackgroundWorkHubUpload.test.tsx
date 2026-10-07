import locales from "@/lib/locales/en.json";
import React from "react";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const env = vi.hoisted(() => ({
  current: true,
  changed: null as null | (() => void),
  scan: vi.fn(),
  begin: vi.fn(),
  scanned: vi.fn(),
  resume: vi.fn(),
  read: vi.fn(),
  cancel: vi.fn(),
  discard: vi.fn(),
  pick: vi.fn(),
}));
vi.mock("react-native", () => ({
  View: ({ children }: any) => <div>{children}</div>,
  Text: ({ children }: any) => <span>{children}</span>,
  Image: ({ source }: any) => <img src={source.uri} />,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key.split(".").reduce((value: any, part) => value?.[part], locales) ??
      key,
    i18n: { language: "en" },
  }),
}));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "black" }) }));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, disabled, onPress }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => env.current,
  subscribeToken: (f: () => void) => {
    env.changed = f;
    return () => {};
  },
  subscribeUser: () => () => {},
}));
vi.mock("@/lib/meeting-files", () => ({ pickMeetingFile: env.pick }));
vi.mock("@/lib/native-work-capture", () => ({
  scanWorkDocumentDraft: env.scan,
}));
vi.mock("@/lib/work-hub-background-upload-native", () => ({
  canBackgroundUploadWorkFile: async () => true,
  beginBackgroundWorkUpload: env.begin,
  beginBackgroundScannedWorkUpload: env.scanned,
  resumeBackgroundWorkUpload: env.resume,
  readPendingWorkUpload: env.read,
  cancelBackgroundWorkUpload: env.cancel,
  discardScannedWorkPages: env.discard,
}));
import BackgroundWorkHubUpload from "./BackgroundWorkHubUpload";
const target = {
  owner: { type: "vendor" as const, id: 4 },
  scope: "personal" as const,
};
const mount = (saved = vi.fn()) =>
  render(
    <BackgroundWorkHubUpload
      target={target}
      disabled={false}
      onAvailability={vi.fn()}
      onSaved={saved}
    />,
  );
beforeEach(() => {
  env.current = true;
  for (const key of [
    "scan",
    "begin",
    "scanned",
    "resume",
    "read",
    "cancel",
    "discard",
    "pick",
  ] as const)
    env[key].mockReset();
  env.read.mockResolvedValue(null);
  env.resume.mockResolvedValue({ state: "uploading", documentId: "document" });
});
afterEach(cleanup);
it("restores pending transport with explicit Resume and no automatic finalize", async () => {
  env.read.mockResolvedValue({
    name: "original.pdf",
    transported: true,
    finalized: false,
  });
  mount();
  await screen.findByText("Pending file attempt: original.pdf");
  expect(env.resume).not.toHaveBeenCalled();
  expect(
    screen.getByText("Bytes transported; saved-file verification remains."),
  ).toBeTruthy();
  fireEvent.click(screen.getByText("Resume and verify"));
  await waitFor(() => expect(env.resume).toHaveBeenCalledTimes(1));
});
it("shows all original scan pages and sends only the explicitly selected second page", async () => {
  const pages = [
    {
      fileId: "first",
      uri: "file:///first",
      byteSize: 2,
      sha256: "a",
      contentType: "image/jpeg",
    },
    {
      fileId: "second",
      uri: "file:///second",
      byteSize: 3,
      sha256: "b",
      contentType: "image/jpeg",
    },
  ];
  env.scan.mockResolvedValue({ pages });
  mount();
  fireEvent.click(await screen.findByText("Scan document"));
  await screen.findByText("Upload this page 2");
  expect(screen.getAllByRole("img")).toHaveLength(2);
  expect(env.scanned).not.toHaveBeenCalled();
  expect(env.discard).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Upload this page 2"));
  await waitFor(() =>
    expect(env.scanned).toHaveBeenCalledWith(
      expect.objectContaining({ page: pages[1], name: "scanned-page-2.jpg" }),
      { generation: 1 },
    ),
  );
  expect(env.discard).not.toHaveBeenCalled();
});
it("retains unresolved attempt and does not claim saved after unknown result", async () => {
  env.read.mockResolvedValue({
    name: "file.pdf",
    transported: true,
    finalized: false,
  });
  env.resume.mockRejectedValue(new Error("unknown"));
  const saved = vi.fn();
  mount(saved);
  fireEvent.click(await screen.findByText("Resume and verify"));
  await screen.findByText(/Result unresolved/);
  expect(saved).not.toHaveBeenCalled();
  expect(env.begin).not.toHaveBeenCalled();
  expect(screen.getByText("Resume and verify")).toBeTruthy();
});
it("fences delayed result and private scan pages after account invalidation", async () => {
  let finish!: (value: unknown) => void;
  env.scan.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  mount();
  fireEvent.click(await screen.findByText("Scan document"));
  env.current = false;
  env.changed?.();
  finish({ pages: [{ fileId: "private", uri: "file:///private" }] });
  await waitFor(() => expect(screen.queryByRole("img")).toBeNull());
  expect(env.scanned).not.toHaveBeenCalled();
});
it("keeps saved but refresh-needed separate from unknown retry", async () => {
  env.read.mockResolvedValue({
    name: "file.pdf",
    transported: true,
    finalized: false,
  });
  env.resume.mockResolvedValue({ state: "saved" });
  mount(vi.fn().mockRejectedValue(new Error("refresh")));
  fireEvent.click(await screen.findByText("Resume and verify"));
  await screen.findByText("File is saved. Refresh the list to see it.");
  expect(screen.queryByText("Resume and verify")).toBeNull();
});
