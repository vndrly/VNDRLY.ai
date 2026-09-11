import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingSnapshot } from "@workspace/api-client-react/meeting-workspace";
import { useMeetingWorkspace } from "./use-meeting-workspace";

const env = vi.hoisted(() => ({
  api: vi.fn(),
  token: "token-a" as string | null,
  auth: { user: { id: 1, activeMembershipId: 10 } as any },
  active: true,
  authGeneration: 1,
  tokenListeners: new Set<(token: string | null) => void>(),
  userListeners: new Set<(user: any) => void>(),
  foreground: new Set<() => void>(),
  background: new Set<() => void>(),
  pickFile: vi.fn(),
  uploadFile: vi.fn(),
  openFile: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ apiFetch: env.api }));
vi.mock("@/lib/meeting-files", () => ({
  pickMeetingFile: env.pickFile,
  uploadMeetingFile: env.uploadFile,
  downloadAndShareMeetingFile: env.openFile,
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => env.auth }));
vi.mock("@/lib/auth", () => ({
  getCachedToken: () => env.token,
  captureAuthScope: () => Object.freeze({ generation: env.authGeneration }),
  isAuthScopeCurrent: (scope: { generation: number }) => scope.generation === env.authGeneration,
  subscribeToken: (listener: (token: string | null) => void) => {
    env.tokenListeners.add(listener);
    return () => env.tokenListeners.delete(listener);
  },
  subscribeUser: (listener: (user: any) => void) => {
    env.userListeners.add(listener);
    return () => env.userListeners.delete(listener);
  },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_key: string, values?: any) => values?.defaultValue ?? _key }) }));
vi.mock("@/lib/askv-audio-session", () => ({
  isAskVAppActive: () => env.active,
  subscribeAskVAppState: (foreground: () => void, background: () => void) => {
    env.foreground.add(foreground);
    env.background.add(background);
    return { remove: () => { env.foreground.delete(foreground); env.background.delete(background); } };
  },
}));

function snapshot(overrides: Partial<MeetingSnapshot> = {}): MeetingSnapshot {
  return {
    userId: 1,
    canManage: false,
    canViewAttendance: true,
    transcription: false,
    myConsent: "declined",
    meeting: { title: "Daily operations", agenda: "Safety first", policyVersion: 1 },
    occurrence: {
      id: "meeting-a", status: "live", startsAt: "2026-09-09T14:00:00.000Z",
      endsAt: "2026-09-09T15:00:00.000Z", startedAt: "2026-09-09T14:00:00.000Z",
      endedAt: null, askvInvitedAt: null,
    },
    participants: [], chat: [], activity: [], transcript: [], attendance: [], recap: null,
    ...overrides,
  };
}

function hostSnapshot(overrides: Partial<MeetingSnapshot> = {}): MeetingSnapshot {
  return snapshot({
    canManage: true,
    participants: [
      { userId: 1, displayName: "Alex Host", role: "host", muted: false, present: true, speaking: false, removedAt: null },
      { userId: 2, displayName: "Bob Brand", role: "attendee", muted: false, present: true, speaking: false, removedAt: null },
      { userId: 3, displayName: "Casey Host", role: "host", muted: false, present: true, speaking: false, removedAt: null },
      { userId: 4, displayName: "Drew Removed", role: "attendee", muted: true, present: false, speaking: false, removedAt: "2026-09-09T14:05:00.000Z" },
    ],
    chat: [{ id: "prior", userId: 2, displayName: "Bob Brand", recipientUserId: null, body: "Prior contribution", messageType: "typed", createdAt: "2026-09-09T14:03:00.000Z" }],
    ...overrides,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle() {
  await act(async () => { for (let index = 0; index < 20; index += 1) await Promise.resolve(); });
}

beforeEach(() => {
  vi.useFakeTimers();
  env.api.mockReset().mockResolvedValue(snapshot());
  env.token = "token-a";
  env.auth.user = { id: 1, activeMembershipId: 10 };
  env.active = true;
  env.authGeneration = 1;
  env.pickFile.mockReset();
  env.uploadFile.mockReset().mockResolvedValue({ attachment: { fileName: "field.pdf", contentType: "application/pdf", byteSize: 3 }, replayed: false });
  env.openFile.mockReset().mockResolvedValue(undefined);
  (globalThis.expo as any).uuidv4 = vi.fn(() => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
});

afterEach(() => {
  cleanup();
  expect(env.tokenListeners.size).toBe(0);
  expect(env.userListeners.size).toBe(0);
  expect(env.foreground.size).toBe(0);
  expect(env.background.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useMeetingWorkspace", () => {
  it("confirms one eligible named removal at the scoped endpoint and accepts only the refreshed server snapshot", async () => {
    const refreshed = hostSnapshot({
      participants: hostSnapshot().participants.map((person) => person.userId === 2
        ? { ...person, present: false, removedAt: "2026-09-09T14:06:00.000Z" }
        : person),
    });
    env.api.mockImplementation(async (path: string) => {
      if (path.endsWith("/participants/2/remove")) return { userId: 2, removedAt: "2026-09-09T14:06:00.000Z" };
      if (env.api.mock.calls.some(([called]) => String(called).endsWith("/participants/2/remove"))) return refreshed;
      return hostSnapshot();
    });
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    const management = () => result.current as any;

    act(() => management().requestRemoveConfirmation(2));
    expect(management().managementConfirmation).toEqual({ kind: "remove", userId: 2, displayName: "Bob Brand" });
    let first!: Promise<void>;
    let duplicate!: Promise<void>;
    act(() => { first = management().confirmManagement(); duplicate = management().confirmManagement(); });
    await act(async () => { await Promise.all([first, duplicate]); });

    const removals = env.api.mock.calls.filter(([path]) => String(path).endsWith("/participants/2/remove"));
    expect(removals).toHaveLength(1);
    expect(removals[0][1]).toMatchObject({ method: "POST", body: "{}" });
    expect(result.current.snapshot?.participants.find((person) => person.userId === 2)?.removedAt).toBe("2026-09-09T14:06:00.000Z");
    expect(result.current.snapshot?.chat[0]?.body).toBe("Prior contribution");
    expect(management().managementNotice).toContain("Bob Brand was removed");
  });

  it("distinguishes an acknowledged removal whose follow-up refresh failed from a rejected mutation", async () => {
    env.api.mockResolvedValueOnce(hostSnapshot())
      .mockResolvedValueOnce({ userId: 2, removedAt: "2026-09-09T14:06:00.000Z" })
      .mockRejectedValueOnce(new Error("refresh failed"));
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    const management = () => result.current as any;
    act(() => management().requestRemoveConfirmation(2));
    await act(async () => { await management().confirmManagement(); });
    expect(management().managementNotice).toContain("Bob Brand was removed");
    expect(management().managementNotice).toContain("Refresh");
    expect(management().managementRefreshFailed).toBe(true);
    expect(result.current.snapshot?.chat[0]?.body).toBe("Prior contribution");
    expect(env.api.mock.calls.filter(([path]) => String(path).endsWith("/participants/2/remove"))).toHaveLength(1);

    env.api.mockResolvedValue(hostSnapshot({
      participants: hostSnapshot().participants.map((person) => person.userId === 2
        ? { ...person, present: false, removedAt: "2026-09-09T14:06:00.000Z" }
        : person),
    }));
    await act(async () => { await result.current.refresh(); });
    expect(management().managementRefreshFailed).toBe(false);
    expect(management().managementNotice).not.toContain("Refresh");
    expect(env.api.mock.calls.filter(([path]) => String(path).endsWith("/participants/2/remove"))).toHaveLength(1);
  });

  it("keeps a rejected management mutation pending until rejection and never reports false success", async () => {
    const removal = deferred<{ userId: number; removedAt: string }>();
    env.api.mockImplementation((path: string) => path.endsWith("/participants/2/remove")
      ? removal.promise
      : Promise.resolve(hostSnapshot()));
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    const management = () => result.current as any;
    act(() => management().requestRemoveConfirmation(2));
    let pending!: Promise<void>;
    act(() => { pending = management().confirmManagement(); });
    expect(management().managementPending).toBe(true);
    expect(management().managementConfirmation).toEqual({ kind: "remove", userId: 2, displayName: "Bob Brand" });
    expect(management().managementNotice).toBe("");
    expect(result.current.snapshot?.participants.find((person) => person.userId === 2)?.removedAt).toBeNull();

    removal.reject(new Error("mutation rejected"));
    await act(async () => { await pending; });
    expect(management().managementPending).toBe(false);
    expect(management().managementNotice).toContain("not removed");
    expect(management().managementNotice).not.toContain("was removed");
    expect(management().managementRefreshFailed).toBe(false);
    expect(result.current.snapshot?.chat[0]?.body).toBe("Prior contribution");
  });

  it.each(["permission", "target"])("rechecks current %s eligibility at management dispatch", async (change) => {
    env.api.mockResolvedValue(hostSnapshot());
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    const management = () => result.current as any;
    act(() => management().requestRemoveConfirmation(2));
    env.api.mockResolvedValue(change === "permission"
      ? hostSnapshot({ canManage: false })
      : hostSnapshot({ participants: hostSnapshot().participants.map((person) => person.userId === 2
        ? { ...person, removedAt: "2026-09-09T14:05:00.000Z", present: false }
        : person) }));
    await act(async () => { await result.current.refresh(); });
    await act(async () => { await management().confirmManagement(); });
    expect(env.api.mock.calls.some(([path]) => String(path).endsWith("/participants/2/remove"))).toBe(false);
    expect(management().managementConfirmation).toBeNull();
  });

  it("does not let a late old management result clear or overwrite a newer pending action", async () => {
    const oldRemoval = deferred<{ userId: number; removedAt: string }>();
    const newEnd = deferred<{ ended: boolean }>();
    env.api.mockImplementation((path: string) => {
      if (path.includes("meeting-a/participants/2/remove")) return oldRemoval.promise;
      if (path.includes("meeting-b/end")) return newEnd.promise;
      const occurrenceId = path.includes("meeting-b/") ? "meeting-b" : "meeting-a";
      return Promise.resolve(hostSnapshot({ occurrence: { ...hostSnapshot().occurrence, id: occurrenceId } }));
    });
    const view = renderHook(({ id }) => useMeetingWorkspace(id), { initialProps: { id: "meeting-a" } });
    await settle();
    act(() => view.result.current.requestRemoveConfirmation(2));
    let oldPending!: Promise<void>;
    act(() => { oldPending = view.result.current.confirmManagement(); });
    view.rerender({ id: "meeting-b" });
    await settle();
    act(() => view.result.current.requestEndConfirmation());
    let newPending!: Promise<void>;
    act(() => { newPending = view.result.current.confirmManagement(); });
    expect(view.result.current.managementPending).toBe(true);
    expect(view.result.current.managementConfirmation).toEqual({ kind: "end" });

    oldRemoval.resolve({ userId: 2, removedAt: "2026-09-09T14:06:00.000Z" });
    await act(async () => { await oldPending; });
    expect(view.result.current.managementPending).toBe(true);
    expect(view.result.current.managementConfirmation).toEqual({ kind: "end" });
    expect(view.result.current.managementNotice).toBe("");

    newEnd.reject(new Error("finish test"));
    await act(async () => { await newPending; });
    expect(view.result.current.managementPending).toBe(false);
    expect(view.result.current.managementNotice).toContain("not ended");
  });

  it("acknowledges an explicit end immediately and never clears it with an older in-flight snapshot", async () => {
    const oldPoll = deferred<MeetingSnapshot>();
    const refresh = deferred<MeetingSnapshot>();
    env.api.mockResolvedValueOnce(hostSnapshot())
      .mockImplementationOnce(() => oldPoll.promise)
      .mockResolvedValueOnce({ ended: true })
      .mockImplementationOnce(() => refresh.promise);
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    let polling!: Promise<void>;
    act(() => { polling = result.current.refresh(); });
    await settle();
    const management = () => result.current as any;
    act(() => management().requestEndConfirmation());
    let ending!: Promise<void>;
    act(() => { ending = management().confirmManagement(); });
    await settle();
    expect(management().meetingEndedAcknowledged).toBe(true);
    const ends = env.api.mock.calls.filter(([path]) => String(path).endsWith("/end"));
    expect(ends).toHaveLength(1);
    expect(ends[0][1]).toMatchObject({ method: "POST", body: "{}" });
    oldPoll.resolve(hostSnapshot());
    await act(async () => { await polling; });
    expect(management().meetingEndedAcknowledged).toBe(true);
    refresh.resolve(hostSnapshot({ occurrence: { ...hostSnapshot().occurrence, status: "ended", endedAt: "2026-09-09T14:10:00.000Z" } }));
    await act(async () => { await ending; });
    expect(result.current.snapshot?.occurrence.status).toBe("ended");
  });

  it.each(["permission", "background", "identity", "meeting"])("invalidates a %s-stale host confirmation without dispatching", async (change) => {
    env.api.mockResolvedValue(hostSnapshot());
    const view = renderHook(({ id }) => useMeetingWorkspace(id), { initialProps: { id: "meeting-a" } });
    await settle();
    const management = () => view.result.current as any;
    act(() => management().requestRemoveConfirmation(2));
    if (change === "permission") {
      env.api.mockResolvedValue(hostSnapshot({ canManage: false }));
      await act(async () => { await view.result.current.refresh(); });
    } else if (change === "background") {
      act(() => { env.active = false; env.background.forEach((listener) => listener()); });
    } else if (change === "identity") {
      act(() => {
        env.authGeneration += 1;
        env.auth.user = { id: 8, activeMembershipId: 80 };
        env.userListeners.forEach((listener) => listener(env.auth.user));
      });
    } else {
      view.rerender({ id: "meeting-b" });
    }
    await act(async () => { await management().confirmManagement(); });
    expect(env.api.mock.calls.some(([path]) => String(path).includes("/participants/2/remove"))).toBe(false);
  });

  it("does not dispatch a host mutation when a confirmation is cancelled or merely rendered/refetched", async () => {
    env.api.mockResolvedValue(hostSnapshot());
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    const management = () => result.current as any;
    act(() => management().requestEndConfirmation());
    act(() => management().cancelManagement());
    await act(async () => { await result.current.refresh(); });
    expect(env.api.mock.calls.some(([path]) => String(path).endsWith("/end"))).toBe(false);
  });

  it("loads the authenticated catch-up path and never overlaps foreground polling", async () => {
    const first = deferred<MeetingSnapshot>();
    env.api.mockReturnValueOnce(first.promise).mockResolvedValue(snapshot());
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    expect(env.api).toHaveBeenCalledOnce();
    expect(env.api.mock.calls[0][0]).toBe("/api/work-hub/meetings/meeting-a/catch-up");
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(env.api).toHaveBeenCalledOnce();
    first.resolve(snapshot());
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(env.api).toHaveBeenCalledTimes(2);
    expect(result.current.snapshot?.meeting.title).toBe("Daily operations");
  });

  it("stops in background and resumes with one fresh foreground catch-up", async () => {
    renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    act(() => { env.active = false; env.background.forEach((listener) => listener()); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(env.api).toHaveBeenCalledTimes(1);
    act(() => { env.active = true; env.foreground.forEach((listener) => listener()); });
    await settle();
    expect(env.api).toHaveBeenCalledTimes(2);
  });

  it("does not let an ignored background request restore over the fresh foreground catch-up", async () => {
    const old = deferred<MeetingSnapshot>();
    const fresh = snapshot({ meeting: { ...snapshot().meeting, title: "Fresh foreground" } });
    env.api.mockReturnValueOnce(old.promise).mockResolvedValueOnce(fresh);
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    act(() => { env.active = false; env.background.forEach((listener) => listener()); });
    act(() => { env.active = true; env.foreground.forEach((listener) => listener()); });
    await settle();
    expect(result.current.snapshot?.meeting.title).toBe("Fresh foreground");
    old.resolve(snapshot({ meeting: { ...snapshot().meeting, title: "Stale background" } }));
    await settle();
    expect(result.current.snapshot?.meeting.title).toBe("Fresh foreground");
  });

  it("never renders a deferred snapshot from an old user, membership, token, or meeting", async () => {
    const old = deferred<MeetingSnapshot>();
    const next = deferred<MeetingSnapshot>();
    let calls = 0;
    env.api.mockImplementation(() => { calls += 1; return calls === 1 ? old.promise : next.promise; });
    const nextSnapshot = snapshot({
      userId: 2,
      occurrence: { ...snapshot().occurrence, id: "meeting-b" },
    });
    const view = renderHook(({ occurrenceId }) => useMeetingWorkspace(occurrenceId), {
      initialProps: { occurrenceId: "meeting-a" },
    });
    await settle();
    act(() => {
      env.auth.user = { id: 2, activeMembershipId: 20 };
      env.token = "token-b";
      env.tokenListeners.forEach((listener) => listener("token-b"));
    });
    view.rerender({ occurrenceId: "meeting-b" });
    await settle();
    expect(view.result.current.snapshot).toBeNull();
    old.resolve(snapshot());
    await settle();
    expect(view.result.current.snapshot).toBeNull();
    next.resolve(nextSnapshot);
    await settle();
    expect(view.result.current.snapshot?.userId).toBe(2);
    expect(view.result.current.snapshot?.occurrence.id).toBe("meeting-b");
  });

  it.each([401, 403, 404, 410])("clears inaccessible meeting state and stops retrying after HTTP %i", async (status) => {
    env.api.mockResolvedValueOnce(snapshot()).mockRejectedValue(Object.assign(new Error("Access lost"), { status }));
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(result.current.snapshot).toBeNull();
    expect(result.current.accessLost).toBe(true);
    const count = env.api.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(env.api).toHaveBeenCalledTimes(count);
  });

  it("keeps authorized content and the draft visible after an offline refresh", async () => {
    let catchUps = 0;
    env.api.mockImplementation(async (path: string) => {
      if (path.endsWith("/activity")) return {};
      catchUps += 1;
      if (catchUps === 2) throw Object.assign(new Error("Offline"), { code: "network.unreachable" });
      return snapshot();
    });
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    act(() => result.current.updateDraft("Field note stays here"));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(result.current.snapshot?.meeting.title).toBe("Daily operations");
    expect(result.current.draft).toBe("Field note stays here");
    expect(result.current.error.toLocaleLowerCase()).toContain("offline");
  });

  it("reuses the same operation ID only for a manual retry of the same text and audience", async () => {
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    (globalThis.expo as any).uuidv4 = vi.fn(() => ids.shift()!);
    env.api.mockImplementation(async (path: string) => {
      if (path.endsWith("/chat")) throw new Error("Ambiguous network failure");
      return snapshot();
    });
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    act(() => result.current.updateDraft("retry me"));
    await act(async () => { await result.current.send(); await result.current.send(); });
    const sends = env.api.mock.calls.filter(([path]) => String(path).endsWith("/chat"));
    expect(JSON.parse(sends[0][1].body).id).toBe("11111111-1111-4111-8111-111111111111");
    expect(JSON.parse(sends[1][1].body).id).toBe("11111111-1111-4111-8111-111111111111");
    act(() => result.current.updateDraft("changed"));
    await act(async () => { await result.current.send(); });
    expect(JSON.parse(env.api.mock.calls.filter(([path]) => String(path).endsWith("/chat"))[2][1].body).id)
      .toBe("22222222-2222-4222-8222-222222222222");
  });

  it("preserves long pasted text and a newer edit when an older send finishes late", async () => {
    const send = deferred<unknown>();
    const long = "Complete field update. ".repeat(250);
    env.api.mockImplementation((path: string) => path.endsWith("/chat") ? send.promise : Promise.resolve(snapshot()));
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    act(() => result.current.updateDraft(long));
    let sending!: Promise<void>;
    act(() => { sending = result.current.send(); });
    act(() => result.current.updateDraft(`${long}new edit`));
    send.resolve({});
    await act(async () => { await sending; });
    expect(result.current.draft).toBe(`${long}new edit`);
    expect(JSON.parse(env.api.mock.calls.find(([path]) => String(path).endsWith("/chat"))![1].body).body).toBe(long.trim());
  });

  it("blocks same-turn sending after auth changes before React rerenders", async () => {
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    act(() => result.current.updateDraft("do not cross auth"));
    await act(async () => {
      env.authGeneration += 1;
      env.token = "token-b";
      env.tokenListeners.forEach((listener) => listener("token-b"));
      await result.current.send();
    });
    expect(env.api.mock.calls.some(([path]) => String(path).endsWith("/chat"))).toBe(false);
    expect(result.current.draft).toBe("do not cross auth");
  });

  it.each(["background", "identity", "meeting"])("retains the draft when a late send finishes after %s invalidation", async (change) => {
    const late = deferred<unknown>();
    env.api.mockImplementation((path: string) => path.endsWith("/chat") ? late.promise : Promise.resolve(snapshot({ occurrence: { ...snapshot().occurrence, id: path.includes("meeting-b") ? "meeting-b" : "meeting-a" } })));
    const view = renderHook(({ id }) => useMeetingWorkspace(id), { initialProps: { id: "meeting-a" } });
    await settle();
    act(() => view.result.current.updateDraft("keep across invalidation"));
    let sending!: Promise<void>;
    act(() => { sending = view.result.current.send(); });
    if (change === "background") {
      act(() => { env.active = false; env.background.forEach((listener) => listener()); });
    } else if (change === "identity") {
      act(() => {
        env.authGeneration += 1;
        env.auth.user = { id: 2, activeMembershipId: 20 };
        env.userListeners.forEach((listener) => listener(env.auth.user));
      });
    } else {
      view.rerender({ id: "meeting-b" });
    }
    late.resolve({});
    await act(async () => { await sending; });
    if (change === "background") {
      expect(view.result.current.draft).toBe("keep across invalidation");
    } else {
      if (change === "identity") {
        act(() => {
          env.authGeneration += 1;
          env.auth.user = { id: 1, activeMembershipId: 10 };
          env.userListeners.forEach((listener) => listener(env.auth.user));
        });
      } else view.rerender({ id: "meeting-a" });
      await settle();
      expect(view.result.current.draft).toBe("keep across invalidation");
    }
  });

  it.each([401, 403, 404, 410])("revokes terminal access reported by activity HTTP %i", async (status) => {
    env.api.mockImplementation((path: string) => path.endsWith("/activity")
      ? Promise.reject(Object.assign(new Error("terminal activity"), { status }))
      : Promise.resolve(snapshot()));
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    act(() => result.current.updateDraft("typing"));
    await settle();
    expect(result.current.snapshot).toBeNull();
    expect(result.current.accessLost).toBe(true);
  });

  it("ignores a late activity error after background invalidates its lifecycle", async () => {
    const activity = deferred<unknown>();
    env.api.mockImplementation((path: string) => path.endsWith("/activity") ? activity.promise : Promise.resolve(snapshot()));
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    act(() => result.current.updateDraft("typing before background"));
    act(() => { env.active = false; env.background.forEach((listener) => listener()); });
    activity.reject(Object.assign(new Error("old terminal"), { status: 410 }));
    await settle();
    act(() => { env.active = true; env.foreground.forEach((listener) => listener()); });
    await settle();
    expect(result.current.accessLost).toBe(false);
    expect(result.current.snapshot?.meeting.title).toBe("Daily operations");
  });

  it("never restores catch-up content after a concurrent chat terminal response", async () => {
    const catchUp = deferred<MeetingSnapshot>();
    env.api.mockResolvedValueOnce(snapshot()).mockImplementation((path: string) => {
      if (path.endsWith("/chat")) return Promise.reject(Object.assign(new Error("gone"), { status: 410 }));
      return catchUp.promise;
    });
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    act(() => result.current.updateDraft("still here"));
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refresh(); });
    await settle();
    await act(async () => { await result.current.send(); });
    expect(result.current.accessLost).toBe(true);
    catchUp.resolve(snapshot({ meeting: { ...snapshot().meeting, title: "late restore" } }));
    await act(async () => { await refresh; });
    expect(result.current.snapshot).toBeNull();
    expect(result.current.draft).toBe("still here");
  });

  it("uses Expo's native UUID when browser crypto.randomUUID is unavailable", async () => {
    const nativeId = "33333333-3333-4333-8333-333333333333";
    (globalThis.expo as any).uuidv4 = vi.fn(() => nativeId);
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => { throw new Error("browser crypto unavailable"); });
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    act(() => result.current.updateDraft("native message"));
    await act(async () => { await result.current.send(); });
    const send = env.api.mock.calls.find(([path]) => String(path).endsWith("/chat"));
    expect(JSON.parse(send![1].body).id).toBe(nativeId);
  });

  it("keeps the draft visible and resets sending when native UUID creation fails", async () => {
    (globalThis.expo as any).uuidv4 = undefined;
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    act(() => result.current.updateDraft("keep this draft"));
    await act(async () => { await result.current.send(); });
    expect(result.current.draft).toBe("keep this draft");
    expect(result.current.sending).toBe(false);
    expect(result.current.error).toContain("Could not prepare this message");
    expect(env.api.mock.calls.some(([path]) => String(path).endsWith("/chat"))).toBe(false);
  });

  it("partitions in-memory drafts by user, membership, meeting, and private thread", async () => {
    const view = renderHook(({ occurrenceId }) => useMeetingWorkspace(occurrenceId), {
      initialProps: { occurrenceId: "meeting-a" },
    });
    await settle();
    act(() => view.result.current.updateDraft("shared A"));
    act(() => view.result.current.selectRecipient(2));
    expect(view.result.current.draft).toBe("");
    act(() => view.result.current.updateDraft("private A"));
    act(() => view.result.current.selectRecipient(null));
    expect(view.result.current.draft).toBe("shared A");
    view.rerender({ occurrenceId: "meeting-b" });
    await settle();
    expect(view.result.current.draft).toBe("");
  });

  it("throttles typing activity, scopes it to the recipient, and aborts work on unmount", async () => {
    const pending = deferred<MeetingSnapshot>();
    let catchUps = 0;
    env.api.mockImplementation((path: string) => {
      if (path.endsWith("/activity")) return Promise.resolve({});
      catchUps += 1;
      return catchUps === 1 ? Promise.resolve(snapshot()) : pending.promise;
    });
    const view = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    act(() => view.result.current.selectRecipient(2));
    act(() => { view.result.current.updateDraft("a"); view.result.current.updateDraft("ab"); });
    await settle();
    const activities = env.api.mock.calls.filter(([path]) => String(path).endsWith("/activity"));
    expect(activities).toHaveLength(1);
    expect(JSON.parse(activities[0][1].body)).toEqual({ kind: "typing", recipientUserId: 2 });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    const requestSignal = env.api.mock.calls.findLast(([path]) => String(path).endsWith("/catch-up"))![1].signal as AbortSignal;
    view.unmount();
    expect(requestSignal.aborted).toBe(true);
    pending.resolve(snapshot());
    await settle();
  });

  it("binds one picked upload to its original audience, keeps the draft, and clears scoped file activity", async () => {
    env.pickFile.mockResolvedValue({ id: "file-id", name: "field.pdf", type: "application/pdf", size: 3, bytes: new Uint8Array([1, 2, 3]) });
    env.api.mockImplementation((path: string) => path.endsWith("/activity") ? Promise.resolve({}) : Promise.resolve(snapshot()));
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    act(() => result.current.updateDraft("draft remains"));
    act(() => result.current.selectRecipient(2));
    let choosing!: Promise<void>;
    act(() => { choosing = result.current.chooseFile("files"); });
    act(() => result.current.selectRecipient(null));
    await act(async () => { await choosing; });
    expect(env.uploadFile).toHaveBeenCalledWith("meeting-a", expect.objectContaining({ id: "file-id" }), 2, expect.anything(), expect.any(AbortSignal));
    expect(result.current.draft).toBe("draft remains");
    const activities = env.api.mock.calls.filter(([path]) => String(path).endsWith("/activity")).map(([, init]) => JSON.parse(init.body));
    expect(activities).toContainEqual({ kind: "file", recipientUserId: 2 });
    expect(activities).toContainEqual({ kind: null, recipientUserId: 2 });
  });

  it("keeps the same selected bytes and UUID for ambiguous manual retry, but cannot resend after acknowledgement", async () => {
    const selected = { id: "stable-id", name: "field.pdf", type: "application/pdf", size: 3, bytes: new Uint8Array([1, 2, 3]) };
    env.pickFile.mockResolvedValue(selected);
    env.uploadFile.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ attachment: { fileName: "field.pdf", contentType: "application/pdf", byteSize: 3 }, replayed: true });
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    await act(async () => { await result.current.chooseFile("files"); });
    expect(result.current.fileRetryAvailable).toBe(true);
    await act(async () => { await result.current.retryFile(); });
    expect(env.uploadFile).toHaveBeenCalledTimes(2);
    expect(env.uploadFile.mock.calls[0][1]).toBe(selected);
    expect(env.uploadFile.mock.calls[1][1]).toBe(selected);
    expect(result.current.fileRetryAvailable).toBe(false);
    await act(async () => { await result.current.retryFile(); });
    expect(env.uploadFile).toHaveBeenCalledTimes(2);
  });

  it("does not let an old scope clear file activity or publish errors into a new meeting", async () => {
    const pick = deferred<any>();
    env.pickFile.mockReturnValue(pick.promise);
    const view = renderHook(({ id }) => useMeetingWorkspace(id), { initialProps: { id: "meeting-a" } });
    await settle();
    let choosing!: Promise<void>;
    act(() => { choosing = view.result.current.chooseFile("camera"); });
    await settle();
    expect(env.pickFile).toHaveBeenCalledOnce();
    view.rerender({ id: "meeting-b" });
    await settle();
    pick.reject(Object.assign(new Error("old denied"), { code: "permission.camera" }));
    await act(async () => { await choosing; });
    expect(view.result.current.fileError).toBe("");
    const clearsForB = env.api.mock.calls.filter(([path, init]) => String(path).includes("meeting-b/activity") && JSON.parse(init.body).kind === null);
    expect(clearsForB).toHaveLength(0);
  });

  it("orders file activity start before picker/read and clear after cancellation with no late start", async () => {
    const started = deferred<unknown>();
    env.api.mockImplementation((path: string, init?: RequestInit) => {
      if (path.endsWith("/activity") && JSON.parse(String(init?.body)).kind === "file") return started.promise;
      return Promise.resolve(snapshot());
    });
    env.pickFile.mockResolvedValue(null);
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await settle();
    let choosing!: Promise<void>;
    act(() => { choosing = result.current.chooseFile("files"); });
    await settle();
    expect(env.pickFile).not.toHaveBeenCalled();
    started.resolve({});
    await act(async () => { await choosing; });
    expect(env.pickFile).toHaveBeenCalledOnce();
    const activity = env.api.mock.calls.filter(([path]) => String(path).endsWith("/activity"));
    expect(activity.map(([, init]) => JSON.parse(init.body).kind)).toEqual(["file", null]);
  });

  it("serializes attachment opens so overlapping requests cannot replace temporary cleanup ownership", async () => {
    const opening = deferred<void>();
    env.openFile.mockReturnValue(opening.promise);
    const data = snapshot({ chat: [{ id: "file", userId: 1, displayName: "Alex", recipientUserId: null, body: "", messageType: "attachment", createdAt: "2026-09-09T14:00:00.000Z", attachment: { fileName: "x.pdf", contentType: "application/pdf", byteSize: 3 } }] });
    env.api.mockResolvedValue(data);
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await act(async () => { await result.current.refresh(); });
    const file = { id: "file", recipientUserId: null, fileName: "x.pdf", contentType: "application/pdf", byteSize: 3 };
    let first!: Promise<void>;
    act(() => { first = result.current.openFile(file); void result.current.openFile(file); });
    await settle();
    expect(env.openFile).toHaveBeenCalledTimes(1);
    opening.resolve();
    await act(async () => { await first; });
  });

  it("opens outbound and incoming attachments only for the selected authorized private pair", async () => {
    const data = snapshot({ participants: [
      { userId: 1, displayName: "Alex", role: "attendee", muted: false, present: true, speaking: false, removedAt: null },
      { userId: 2, displayName: "Bob", role: "attendee", muted: false, present: true, speaking: false, removedAt: null },
      { userId: 3, displayName: "Casey", role: "attendee", muted: false, present: true, speaking: false, removedAt: null },
    ], chat: [
      { id: "outbound", userId: 1, displayName: "Alex", recipientUserId: 2, body: "", messageType: "attachment", createdAt: "2026-09-09T14:00:00.000Z", attachment: { fileName: "out.pdf", contentType: "application/pdf", byteSize: 3 } },
      { id: "incoming", userId: 2, displayName: "Bob", recipientUserId: 1, body: "", messageType: "attachment", createdAt: "2026-09-09T14:01:00.000Z", attachment: { fileName: "in.pdf", contentType: "application/pdf", byteSize: 4 } },
      { id: "wrong", userId: 3, displayName: "Casey", recipientUserId: 1, body: "", messageType: "attachment", createdAt: "2026-09-09T14:02:00.000Z", attachment: { fileName: "wrong.pdf", contentType: "application/pdf", byteSize: 5 } },
      { id: "shared", userId: 2, displayName: "Bob", recipientUserId: null, body: "", messageType: "attachment", createdAt: "2026-09-09T14:03:00.000Z", attachment: { fileName: "shared.pdf", contentType: "application/pdf", byteSize: 6 } },
    ] });
    env.api.mockResolvedValue(data);
    const opened: string[] = [];
    env.openFile.mockImplementation(async (input: any) => { input.assertCurrent(); opened.push(input.fileId); });
    const { result } = renderHook(() => useMeetingWorkspace("meeting-a"));
    await act(async () => { await result.current.refresh(); });
    act(() => result.current.selectRecipient(2));
    await act(async () => {
      await result.current.openFile({ id: "outbound", recipientUserId: 2, fileName: "out.pdf", contentType: "application/pdf", byteSize: 3 });
      await result.current.openFile({ id: "incoming", recipientUserId: 1, fileName: "in.pdf", contentType: "application/pdf", byteSize: 4 });
      await result.current.openFile({ id: "wrong", recipientUserId: 1, fileName: "wrong.pdf", contentType: "application/pdf", byteSize: 5 });
      await result.current.openFile({ id: "shared", recipientUserId: null, fileName: "shared.pdf", contentType: "application/pdf", byteSize: 6 });
    });
    expect(opened).toEqual(["outbound", "incoming"]);
  });

  it("blocks private attachment work after returning to shared view, changing recipient, or switching meeting scope", async () => {
    const data = snapshot({ participants: [
      { userId: 1, displayName: "Alex", role: "attendee", muted: false, present: true, speaking: false, removedAt: null },
      { userId: 2, displayName: "Bob", role: "attendee", muted: false, present: true, speaking: false, removedAt: null },
      { userId: 3, displayName: "Casey", role: "attendee", muted: false, present: true, speaking: false, removedAt: null },
    ], chat: [{ id: "incoming", userId: 2, displayName: "Bob", recipientUserId: 1, body: "", messageType: "attachment", createdAt: "2026-09-09T14:01:00.000Z", attachment: { fileName: "in.pdf", contentType: "application/pdf", byteSize: 4 } }] });
    env.api.mockResolvedValue(data);
    const opened: string[] = [];
    env.openFile.mockImplementation(async (input: any) => { input.assertCurrent(); opened.push(input.fileId); });
    const view = renderHook(({ id }) => useMeetingWorkspace(id), { initialProps: { id: "meeting-a" } });
    await act(async () => { await view.result.current.refresh(); });
    await act(async () => { await view.result.current.openFile({ id: "incoming", recipientUserId: 1, fileName: "in.pdf", contentType: "application/pdf", byteSize: 4 }); });
    expect(opened).toEqual([]);
    const gate = deferred<void>();
    env.openFile.mockImplementation(async (input: any) => { await gate.promise; input.assertCurrent(); opened.push(input.fileId); });
    act(() => view.result.current.selectRecipient(2));
    let stale!: Promise<void>;
    act(() => { stale = view.result.current.openFile({ id: "incoming", recipientUserId: 1, fileName: "in.pdf", contentType: "application/pdf", byteSize: 4 }); });
    act(() => view.result.current.selectRecipient(3));
    view.rerender({ id: "meeting-b" });
    gate.resolve();
    await act(async () => { await stale; });
    expect(opened).toEqual([]);
  });

  it("cleans temporary open files on scope change and unmount without transferring cleanup ownership", async () => {
    const file = { id: "file", recipientUserId: null, fileName: "x.pdf", contentType: "application/pdf", byteSize: 3 };
    const data = snapshot({ chat: [{ id: "file", userId: 1, displayName: "Alex", recipientUserId: null, body: "", messageType: "attachment", createdAt: "2026-09-09T14:00:00.000Z", attachment: { fileName: "x.pdf", contentType: "application/pdf", byteSize: 3 } }] });
    env.api.mockResolvedValue(data);
    const firstCleanup = vi.fn();
    const firstOpen = deferred<void>();
    env.openFile.mockImplementationOnce((input: any) => {
      input.registerTemporaryCleanup(firstCleanup);
      return firstOpen.promise;
    });
    const scoped = renderHook(({ id }) => useMeetingWorkspace(id), { initialProps: { id: "meeting-a" } });
    await act(async () => { await scoped.result.current.refresh(); });
    let opening!: Promise<void>;
    act(() => { opening = scoped.result.current.openFile(file); });
    await settle();
    scoped.rerender({ id: "meeting-b" });
    expect(firstCleanup).toHaveBeenCalledOnce();
    firstOpen.resolve();
    await act(async () => { await opening; });
    scoped.unmount();

    const secondCleanup = vi.fn();
    const secondOpen = deferred<void>();
    env.openFile.mockImplementationOnce((input: any) => {
      input.registerTemporaryCleanup(secondCleanup);
      return secondOpen.promise;
    });
    const mounted = renderHook(() => useMeetingWorkspace("meeting-a"));
    await act(async () => { await mounted.result.current.refresh(); });
    act(() => { void mounted.result.current.openFile(file); });
    await settle();
    mounted.unmount();
    expect(secondCleanup).toHaveBeenCalledOnce();
    secondOpen.resolve();
  });
});
