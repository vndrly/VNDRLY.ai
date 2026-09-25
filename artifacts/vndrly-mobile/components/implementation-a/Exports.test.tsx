import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImplementationAExports } from "./Exports";

const env = vi.hoisted(() => ({
  generation: 1,
  raw: vi.fn(),
  write: vi.fn(async (_uri: string, _contents: string) => undefined),
  remove: vi.fn(async () => undefined),
  share: vi.fn(async () => undefined),
}));
vi.mock("@/lib/api", () => ({ apiFetchRaw: env.raw, getApiBase: () => "https://example.test" }));
vi.mock("@/lib/auth", () => ({
  getToken: vi.fn(async () => "token"),
  captureAuthScope: () => ({ generation: env.generation }),
  isAuthScopeCurrent: (scope: { generation: number }) => scope.generation === env.generation,
}));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ card: "white", text: "black", mutedForeground: "gray", border: "gray", primary: "blue" }) }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, accessibilityLabel, onPress }: any) => <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button> }));
vi.mock("expo-file-system/legacy", () => ({ cacheDirectory: "file:///cache/", writeAsStringAsync: env.write, deleteAsync: env.remove }));
vi.mock("expo-sharing", () => ({ shareAsync: env.share }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const owner = { type: "vendor" as const, id: 41 };
const oldFetch = globalThis.fetch;
function pendingCsv() {
  const csv = deferred<string>();
  env.raw.mockResolvedValue({ text: () => csv.promise });
  globalThis.fetch = vi.fn(async () => ({ ok: true, text: () => csv.promise })) as unknown as typeof fetch;
  return csv;
}
async function waitForRequest() {
  await waitFor(() => expect(env.raw.mock.calls.length + (globalThis.fetch as any).mock.calls.length).toBe(1));
}
afterEach(() => {
  cleanup();
  globalThis.fetch = oldFetch;
  env.generation = 1;
  env.raw.mockReset();
  env.write.mockReset().mockResolvedValue(undefined);
  env.remove.mockReset().mockResolvedValue(undefined);
  env.share.mockReset().mockResolvedValue(undefined);
});

describe("Implementation A CSV scope", () => {
  it("uses the native UUID when browser crypto is unavailable", async () => {
    (globalThis.expo as any).uuidv4 = () => "11111111-1111-4111-8111-111111111111";
    const browserUuid = vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => { throw new Error("Browser UUID unavailable"); });
    try {
      const csv = pendingCsv();
      render(<ImplementationAExports owner={owner} allowedDatasets={["staffing"]} />);
      fireEvent.click(screen.getByRole("button", { name: "Create Staffing CSV" }));
      await waitForRequest();
      await act(async () => { csv.resolve("worker\r\nA\r\n"); });
      await waitFor(() => expect(env.share).toHaveBeenCalledOnce());
      expect(env.write.mock.calls[0]![0]).toContain("11111111-1111-4111-8111-111111111111.csv");
    } finally { browserUuid.mockRestore(); }
  });
  it("shares a current owner's CSV through the auth-scoped request and cleans its temporary file", async () => {
    const csv = pendingCsv();
    render(<ImplementationAExports owner={owner} allowedDatasets={["staffing"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Create Staffing CSV" }));
    await waitForRequest();
    await act(async () => { csv.resolve("worker\r\nA\r\n"); await csv.promise; });
    await waitFor(() => expect(env.share).toHaveBeenCalledOnce());
    expect(env.raw).toHaveBeenCalledWith("/api/work-hub/exports/implementation-a", expect.objectContaining({ method: "POST", body: JSON.stringify({ dataset: "staffing", scope: { ownerOrgType: "vendor", ownerOrgId: 41 } }) }), { generation: 1 });
    expect(env.write).toHaveBeenCalledOnce();
    expect(env.remove).toHaveBeenCalledWith(env.write.mock.calls[0]![0], { idempotent: true });
  });

  it("does not save or share a response after authentication changes during download", async () => {
    const csv = pendingCsv();
    render(<ImplementationAExports owner={owner} allowedDatasets={["staffing"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Create Staffing CSV" }));
    await waitForRequest();
    env.generation += 1;
    await act(async () => { csv.resolve("worker\r\nA\r\n"); await csv.promise; });
    expect(env.write).not.toHaveBeenCalled();
    expect(env.share).not.toHaveBeenCalled();
  });

  it("does not save or share the previous owner's response after an owner switch", async () => {
    const csv = pendingCsv();
    const view = render(<ImplementationAExports owner={owner} allowedDatasets={["staffing"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Create Staffing CSV" }));
    await waitForRequest();
    view.rerender(<ImplementationAExports owner={{ type: "vendor", id: 42 }} allowedDatasets={["staffing"]} />);
    await act(async () => { csv.resolve("worker\r\nA\r\n"); await csv.promise; });
    expect(env.write).not.toHaveBeenCalled();
    expect(env.share).not.toHaveBeenCalled();
  });

  it("removes a temporary CSV and does not share it if authentication changes during the file write", async () => {
    const csv = pendingCsv();
    const write = deferred<undefined>();
    env.write.mockReturnValue(write.promise);
    render(<ImplementationAExports owner={owner} allowedDatasets={["staffing"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Create Staffing CSV" }));
    await waitForRequest();
    await act(async () => { csv.resolve("worker\r\nA\r\n"); await csv.promise; });
    await waitFor(() => expect(env.write).toHaveBeenCalledOnce());
    env.generation += 1;
    await act(async () => { write.resolve(undefined); await write.promise; });
    expect(env.share).not.toHaveBeenCalled();
    expect(env.remove).toHaveBeenCalledOnce();
  });

  it("does not save or share a response after the export card unmounts", async () => {
    const csv = pendingCsv();
    const view = render(<ImplementationAExports owner={owner} allowedDatasets={["staffing"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Create Staffing CSV" }));
    await waitForRequest();
    view.unmount();
    await act(async () => { csv.resolve("worker\r\nA\r\n"); await csv.promise; });
    expect(env.write).not.toHaveBeenCalled();
    expect(env.share).not.toHaveBeenCalled();
  });
});
