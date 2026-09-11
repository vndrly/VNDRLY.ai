import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MeetingSnapshot } from "@workspace/api-client-react/meeting-workspace";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api";
import {
  downloadAndShareMeetingFile,
  pickMeetingFile,
  persistMeetingFileForOffline,
  uploadMeetingFile,
  type MeetingFileSource,
  type OwnedMeetingFile,
} from "@/lib/meeting-files";
import { nativeUuid } from "@/lib/native-uuid";
import {
  captureAuthScope,
  getCachedToken,
  isAuthScopeCurrent,
  subscribeToken,
  subscribeUser,
} from "@/lib/auth";
import { isAskVAppActive, subscribeAskVAppState } from "@/lib/askv-audio-session";
import { flushNativeWorkHubQueue, isOfflineWorkHubFailure, queueNativeWorkHubRequest, queueNativeWorkHubUpload } from "@/lib/work-hub-queue-runtime";

const POLL_MS = 2_000;
const TYPING_THROTTLE_MS = 1_800;
const drafts = new Map<string, string>();

type PendingMessage = { id: string; body: string; recipientUserId: number | null };
type ScopedSnapshot = { scope: string; generation: number; data: MeetingSnapshot };
type ApiFailure = Error & { status?: number; code?: string };
type PendingFile = { file: OwnedMeetingFile; recipientUserId: number | null; scope: string; generation: number };
type FileActivityLifecycle = { start: () => Promise<void>; stop: () => void };
type FileUploadOwnership = {
  owner: symbol;
  activity: FileActivityLifecycle;
  authScope: ReturnType<typeof captureAuthScope>;
};
export type MeetingManagementConfirmation =
  | { kind: "remove"; userId: number; displayName: string }
  | { kind: "end" };
type BoundManagementConfirmation = MeetingManagementConfirmation & { scope: string; generation: number };

function abortError() {
  return Object.assign(new Error("Meeting request cancelled"), { name: "AbortError" });
}

function isAbort(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function isTerminal(error: unknown) {
  const status = (error as ApiFailure | undefined)?.status;
  return status === 401 || status === 403 || status === 404 || status === 410;
}

function canUseConfirmation(snapshot: MeetingSnapshot | null, confirmation: MeetingManagementConfirmation) {
  if (!snapshot?.canManage || ["ended", "cancelled"].includes(snapshot.occurrence.status)) return false;
  if (confirmation.kind === "end") return true;
  const target = snapshot.participants.find((person) => person.userId === confirmation.userId);
  return Boolean(target && target.userId !== snapshot.userId && target.role !== "host" && !target.removedAt);
}

export type MeetingWorkspaceState = {
  snapshot: MeetingSnapshot | null;
  loading: boolean;
  error: string;
  accessLost: boolean;
  recipientUserId: number | null;
  draft: string;
  sending: boolean;
  managementConfirmation: MeetingManagementConfirmation | null;
  managementPending: boolean;
  managementNotice: string;
  managementRefreshFailed: boolean;
  meetingEndedAcknowledged: boolean;
  fileBusy: boolean;
  fileError: string;
  fileNotice: string;
  fileRefreshFailed: boolean;
  fileRetryAvailable: boolean;
  now: number;
  selectRecipient: (userId: number | null) => void;
  updateDraft: (value: string) => void;
  send: () => Promise<void>;
  refresh: () => Promise<void>;
  requestRemoveConfirmation: (userId: number) => void;
  requestEndConfirmation: () => void;
  cancelManagement: () => void;
  confirmManagement: () => Promise<void>;
  chooseFile: (source: MeetingFileSource) => Promise<void>;
  retryFile: () => Promise<void>;
  openFile: (file: { id: string; recipientUserId: number | null; fileName: string; contentType: string; byteSize: number }) => Promise<void>;
};

export function useMeetingWorkspace(occurrenceId: string): MeetingWorkspaceState {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const membershipId = user?.activeMembershipId ?? null;
  const [authGeneration, setAuthGeneration] = useState(0);
  const token = getCachedToken();
  const scope = `${userId ?? "none"}:${membershipId ?? "none"}:${occurrenceId}:${token ?? "none"}:${authGeneration}`;
  const [storedSnapshot, setStoredSnapshot] = useState<ScopedSnapshot | null>(null);
  const [loadingScope, setLoadingScope] = useState<string | null>(scope);
  const [error, setError] = useState("");
  const [accessLostScope, setAccessLostScope] = useState<string | null>(null);
  const [recipientUserId, setRecipientUserId] = useState<number | null>(null);
  const draftPrefix = `${userId ?? "none"}:${membershipId ?? "none"}:${occurrenceId}`;
  const draftKey = `${draftPrefix}:${recipientUserId ?? "shared"}`;
  const [draft, setDraft] = useState(() => drafts.get(draftKey) ?? "");
  const [sending, setSending] = useState(false);
  const [managementConfirmation, setManagementConfirmation] = useState<MeetingManagementConfirmation | null>(null);
  const [managementPending, setManagementPending] = useState(false);
  const [managementNotice, setManagementNotice] = useState("");
  const [managementRefreshFailed, setManagementRefreshFailed] = useState(false);
  const [endedAcknowledgedScope, setEndedAcknowledgedScope] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState("");
  const [fileNotice, setFileNotice] = useState("");
  const [fileRefreshFailed, setFileRefreshFailed] = useState(false);

  const scopeRef = useRef(scope);
  const occurrenceRef = useRef(occurrenceId);
  const draftKeyRef = useRef(draftKey);
  const draftRef = useRef(draft);
  const recipientRef = useRef(recipientUserId);
  const activeRef = useRef(isAskVAppActive());
  const mountedRef = useRef(true);
  const lifecycleRef = useRef(0);
  const snapshotGenerationRef = useRef(-1);
  const controllersRef = useRef(new Set<AbortController>());
  const pollOwnerRef = useRef<symbol | null>(null);
  const sendOwnerRef = useRef<symbol | null>(null);
  const terminalScopesRef = useRef(new Set<string>());
  const pendingRef = useRef<PendingMessage | null>(null);
  const sendingRef = useRef(false);
  const activityAtRef = useRef(0);
  const snapshotRef = useRef<MeetingSnapshot | null>(null);
  const managementConfirmationRef = useRef<BoundManagementConfirmation | null>(null);
  const managementOwnerRef = useRef<symbol | null>(null);
  const managementRefreshFailedRef = useRef(false);
  const fileOwnerRef = useRef<symbol | null>(null);
  const pendingFileRef = useRef<PendingFile | null>(null);
  const fileCleanupRef = useRef<(() => void) | null>(null);
  const openOwnerRef = useRef<symbol | null>(null);
  const fileActivityRef = useRef<FileActivityLifecycle | null>(null);

  scopeRef.current = scope;
  occurrenceRef.current = occurrenceId;
  draftKeyRef.current = draftKey;
  draftRef.current = draft;
  recipientRef.current = recipientUserId;

  const snapshot = storedSnapshot?.scope === scope &&
    storedSnapshot.generation === lifecycleRef.current &&
    storedSnapshot.data.userId === userId &&
    !terminalScopesRef.current.has(scope)
    ? storedSnapshot.data
    : null;
  const accessLost = accessLostScope === scope || terminalScopesRef.current.has(scope);
  snapshotRef.current = snapshot;

  const abortRequests = useCallback(() => {
    for (const controller of controllersRef.current) controller.abort();
    controllersRef.current.clear();
    pollOwnerRef.current = null;
  }, []);

  const invalidate = useCallback((preservePendingFile = false) => {
    fileActivityRef.current?.stop();
    fileActivityRef.current = null;
    lifecycleRef.current += 1;
    snapshotGenerationRef.current = -1;
    abortRequests();
    sendOwnerRef.current = null;
    sendingRef.current = false;
    managementConfirmationRef.current = null;
    managementOwnerRef.current = null;
    managementRefreshFailedRef.current = false;
    fileOwnerRef.current = null;
    fileCleanupRef.current?.();
    fileCleanupRef.current = null;
    openOwnerRef.current = null;
    if (!preservePendingFile) pendingFileRef.current = null;
    if (mountedRef.current) {
      setSending(false);
      setManagementConfirmation(null);
      setManagementPending(false);
      setManagementNotice("");
      setManagementRefreshFailed(false);
      setEndedAcknowledgedScope(null);
      setFileBusy(false);
      setFileError("");
      setFileNotice("");
      setFileRefreshFailed(false);
    }
  }, [abortRequests]);

  const revoke = useCallback((requestScope: string, message?: string) => {
    if (!mountedRef.current || scopeRef.current !== requestScope) return;
    terminalScopesRef.current.add(requestScope);
    invalidate();
    setStoredSnapshot(null);
    setAccessLostScope(requestScope);
    setLoadingScope(null);
    setError(message ?? t("meetingWorkspace.errors.accessLost", { defaultValue: "Meeting access changed. Reopen the meeting to continue." }));
  }, [invalidate, t]);

  const request = useCallback(async <T,>(
    requestScope: string,
    generation: number,
    path: string,
    init?: RequestInit,
  ): Promise<T> => {
    const authScope = captureAuthScope();
    if (!mountedRef.current || !activeRef.current || scopeRef.current !== requestScope ||
      lifecycleRef.current !== generation || !isAuthScopeCurrent(authScope)) throw abortError();
    const controller = new AbortController();
    controllersRef.current.add(controller);
    try {
      const result = await apiFetch<T>(path, { ...init, signal: controller.signal }, authScope);
      if (!mountedRef.current || !activeRef.current || scopeRef.current !== requestScope ||
        lifecycleRef.current !== generation || !isAuthScopeCurrent(authScope)) throw abortError();
      return result;
    } catch (cause) {
      if (!mountedRef.current || !activeRef.current || scopeRef.current !== requestScope ||
        lifecycleRef.current !== generation || !isAuthScopeCurrent(authScope)) throw abortError();
      throw cause;
    } finally {
      controllersRef.current.delete(controller);
    }
  }, []);

  const createFileActivity = useCallback((
    requestScope: string,
    generation: number,
    occurrenceId: string,
    recipientUserId: number | null,
    authScope: ReturnType<typeof captureAuthScope>,
  ): FileActivityLifecycle => {
    let stopped = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let queue = Promise.resolve();
    const activityPath = `/api/work-hub/meetings/${encodeURIComponent(occurrenceId)}/activity`;
    const enqueue = (kind: "file" | null, propagate = false) => {
      const work = queue.catch(() => undefined).then(async () => {
        if (kind === "file" && stopped) return;
        await apiFetch(activityPath, {
          method: "POST",
          body: JSON.stringify({ kind, recipientUserId }),
        }, authScope);
      });
      queue = work.catch(() => undefined);
      return propagate ? work : queue;
    };
    return {
      async start() {
        await enqueue("file", true);
        if (stopped || scopeRef.current !== requestScope || lifecycleRef.current !== generation ||
          !isAuthScopeCurrent(authScope)) return;
        heartbeat = setInterval(() => {
          if (!stopped && scopeRef.current === requestScope && lifecycleRef.current === generation &&
            isAuthScopeCurrent(authScope)) void enqueue("file");
        }, 5_000);
      },
      stop() {
        if (stopped) return;
        stopped = true;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        void enqueue(null);
      },
    };
  }, []);

  const refresh = useCallback(async () => {
    const requestScope = scopeRef.current;
    const activeUserId = userId;
    if (!activeUserId || !getCachedToken() || !activeRef.current || pollOwnerRef.current ||
      terminalScopesRef.current.has(requestScope)) return;
    const owner = Symbol("meeting-poll");
    const generation = lifecycleRef.current;
    pollOwnerRef.current = owner;
    setLoadingScope(requestScope);
    try {
      if (user) await flushNativeWorkHubQueue(user);
      const next = await request<MeetingSnapshot>(
        requestScope,
        generation,
        `/api/work-hub/meetings/${encodeURIComponent(occurrenceRef.current)}/catch-up`,
      );
      if (next.userId !== activeUserId) {
        revoke(requestScope);
        return;
      }
      if (terminalScopesRef.current.has(requestScope) || lifecycleRef.current !== generation) return;
      snapshotGenerationRef.current = generation;
      setStoredSnapshot({ scope: requestScope, generation, data: next });
      if (pendingFileRef.current?.scope === requestScope) pendingFileRef.current.generation = generation;
      const confirmation = managementConfirmationRef.current;
      if (confirmation && !canUseConfirmation(next, confirmation)) {
        managementConfirmationRef.current = null;
        setManagementConfirmation(null);
      }
      setAccessLostScope(null);
      setError("");
      if (managementRefreshFailedRef.current) {
        managementRefreshFailedRef.current = false;
        setManagementRefreshFailed(false);
        setManagementNotice("");
      }
    } catch (cause) {
      if (isAbort(cause) || scopeRef.current !== requestScope || lifecycleRef.current !== generation) return;
      if (isTerminal(cause)) {
        revoke(requestScope);
        return;
      }
      const offline = (cause as ApiFailure | undefined)?.code === "network.unreachable";
      setError(offline
        ? t("meetingWorkspace.errors.offline", { defaultValue: "You're offline. This meeting will update when you reconnect." })
        : t("meetingWorkspace.errors.update", { defaultValue: "Could not update this meeting." }));
    } finally {
      if (pollOwnerRef.current === owner) {
        pollOwnerRef.current = null;
        if (mountedRef.current && scopeRef.current === requestScope && lifecycleRef.current === generation)
          setLoadingScope(null);
      }
    }
  }, [request, revoke, t, user, userId]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    mountedRef.current = true;
    const invalidateAuth = () => {
      invalidate();
      setAuthGeneration((value) => value + 1);
    };
    const unsubscribeToken = subscribeToken(invalidateAuth);
    const unsubscribeUser = subscribeUser(invalidateAuth);
    return () => {
      mountedRef.current = false;
      lifecycleRef.current += 1;
      snapshotGenerationRef.current = -1;
      abortRequests();
      sendOwnerRef.current = null;
      fileCleanupRef.current?.();
      fileCleanupRef.current = null;
      openOwnerRef.current = null;
      fileActivityRef.current?.stop();
      fileActivityRef.current = null;
      unsubscribeToken();
      unsubscribeUser();
    };
  }, [abortRequests, invalidate]);

  useEffect(() => {
    invalidate();
    setStoredSnapshot(null);
    setAccessLostScope(null);
    setError("");
    setRecipientUserId(null);
    pendingRef.current = null;
    const nextDraftKey = `${draftPrefix}:shared`;
    const nextDraft = drafts.get(nextDraftKey) ?? "";
    draftKeyRef.current = nextDraftKey;
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    if (userId && token && activeRef.current) void refreshRef.current();
  }, [draftPrefix, invalidate, scope, token, userId]);

  useEffect(() => {
    const subscription = subscribeAskVAppState(
      () => {
        activeRef.current = true;
        void refresh();
      },
      () => {
        activeRef.current = false;
        invalidate(true);
      },
    );
    return () => subscription.remove();
  }, [invalidate, refresh]);

  useEffect(() => {
    const poll = setInterval(() => { if (activeRef.current) void refresh(); }, POLL_MS);
    return () => clearInterval(poll);
  }, [refresh]);

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(clock);
  }, []);

  const postActivity = useCallback((kind: "typing" | null, audience: number | null) => {
    const requestScope = scopeRef.current;
    const generation = lifecycleRef.current;
    if (!snapshot || !activeRef.current || accessLost ||
      snapshotGenerationRef.current !== generation) return;
    const current = Date.now();
    if (kind === "typing" && current - activityAtRef.current < TYPING_THROTTLE_MS) return;
    if (kind === "typing") activityAtRef.current = current;
    void request(requestScope, generation, `/api/work-hub/meetings/${encodeURIComponent(occurrenceRef.current)}/activity`, {
      method: "POST",
      body: JSON.stringify({ kind, recipientUserId: audience }),
    }).catch((cause) => {
      if (isTerminal(cause)) revoke(requestScope);
    });
  }, [accessLost, request, revoke, snapshot]);

  const selectRecipient = useCallback((nextRecipient: number | null) => {
    drafts.set(draftKeyRef.current, draftRef.current);
    const nextKey = `${draftPrefix}:${nextRecipient ?? "shared"}`;
    const nextDraft = drafts.get(nextKey) ?? "";
    recipientRef.current = nextRecipient;
    draftKeyRef.current = nextKey;
    draftRef.current = nextDraft;
    setRecipientUserId(nextRecipient);
    setDraft(nextDraft);
  }, [draftPrefix]);

  const updateDraft = useCallback((value: string) => {
    draftRef.current = value;
    drafts.set(draftKeyRef.current, value);
    setDraft(value);
    postActivity(value ? "typing" : null, recipientRef.current);
  }, [postActivity]);

  const send = useCallback(async () => {
    const body = draftRef.current.trim();
    const requestScope = scopeRef.current;
    const generation = lifecycleRef.current;
    if (!body || sendingRef.current || !snapshot || accessLost || !activeRef.current ||
      snapshotGenerationRef.current !== generation || terminalScopesRef.current.has(requestScope)) return;
    const audience = recipientRef.current;
    let operation: PendingMessage;
    try {
      operation = pendingRef.current?.body === body && pendingRef.current.recipientUserId === audience
        ? pendingRef.current
        : { id: nativeUuid(), body, recipientUserId: audience };
    } catch {
      setError(t("meetingWorkspace.errors.prepareMessage", { defaultValue: "Could not prepare this message. Your draft is still here." }));
      return;
    }
    const owner = Symbol("meeting-send");
    pendingRef.current = operation;
    sendOwnerRef.current = owner;
    sendingRef.current = true;
    setSending(true);
    setError("");
    postActivity(null, audience);
    try {
      await request(requestScope, generation, `/api/work-hub/meetings/${encodeURIComponent(occurrenceRef.current)}/chat`, {
        method: "POST",
        body: JSON.stringify(operation),
      });
      if (sendOwnerRef.current !== owner || lifecycleRef.current !== generation ||
        terminalScopesRef.current.has(requestScope)) return;
      pendingRef.current = null;
      if (recipientRef.current === audience && draftRef.current.trim() === body) {
        draftRef.current = "";
        drafts.set(draftKeyRef.current, "");
        setDraft("");
      }
      await refresh();
    } catch (cause) {
      if (isTerminal(cause)) {
        revoke(requestScope);
        return;
      }
      if (isAbort(cause) || sendOwnerRef.current !== owner || scopeRef.current !== requestScope ||
        lifecycleRef.current !== generation) return;
      if (user && isOfflineWorkHubFailure(cause)) {
        await queueNativeWorkHubRequest(user, `/api/work-hub/meetings/${encodeURIComponent(occurrenceRef.current)}/chat`, "POST", operation, operation.id);
        pendingRef.current = null;
        if (recipientRef.current === audience && draftRef.current.trim() === body) {
          draftRef.current = ""; drafts.set(draftKeyRef.current, ""); setDraft("");
        }
        setError(t("meetingWorkspace.errors.queued", { defaultValue: "Saved securely on this device. It will send when you reconnect." }));
      } else setError(t("meetingWorkspace.errors.send", { defaultValue: "Message was not sent. Your draft is still here." }));
    } finally {
      if (sendOwnerRef.current === owner) {
        sendOwnerRef.current = null;
        sendingRef.current = false;
        if (mountedRef.current) setSending(false);
      }
    }
  }, [accessLost, postActivity, refresh, request, revoke, snapshot, t]);

  const requestRemoveConfirmation = useCallback((targetUserId: number) => {
    const current = snapshotRef.current;
    const target = current?.participants.find((person) => person.userId === targetUserId);
    const publicConfirmation: MeetingManagementConfirmation = {
      kind: "remove",
      userId: targetUserId,
      displayName: target?.displayName ?? "",
    };
    if (managementOwnerRef.current || !target || !canUseConfirmation(current, publicConfirmation)) return;
    const bound = { ...publicConfirmation, scope: scopeRef.current, generation: lifecycleRef.current };
    managementConfirmationRef.current = bound;
    setManagementConfirmation(publicConfirmation);
    setManagementNotice("");
    managementRefreshFailedRef.current = false;
    setManagementRefreshFailed(false);
  }, []);

  const requestEndConfirmation = useCallback(() => {
    const publicConfirmation: MeetingManagementConfirmation = { kind: "end" };
    if (managementOwnerRef.current || !canUseConfirmation(snapshotRef.current, publicConfirmation)) return;
    managementConfirmationRef.current = {
      ...publicConfirmation,
      scope: scopeRef.current,
      generation: lifecycleRef.current,
    };
    setManagementConfirmation(publicConfirmation);
    setManagementNotice("");
    managementRefreshFailedRef.current = false;
    setManagementRefreshFailed(false);
  }, []);

  const cancelManagement = useCallback(() => {
    if (managementOwnerRef.current) return;
    managementConfirmationRef.current = null;
    setManagementConfirmation(null);
  }, []);

  const confirmManagement = useCallback(async () => {
    const confirmation = managementConfirmationRef.current;
    const current = snapshotRef.current;
    if (!confirmation || managementOwnerRef.current || confirmation.scope !== scopeRef.current ||
      confirmation.generation !== lifecycleRef.current || !activeRef.current ||
      snapshotGenerationRef.current !== lifecycleRef.current || !canUseConfirmation(current, confirmation)) {
      managementConfirmationRef.current = null;
      if (mountedRef.current) setManagementConfirmation(null);
      return;
    }
    const owner = Symbol("meeting-management");
    const requestScope = confirmation.scope;
    const generation = confirmation.generation;
    managementOwnerRef.current = owner;
    setManagementPending(true);
    setManagementNotice("");
    managementRefreshFailedRef.current = false;
    setManagementRefreshFailed(false);
    let acknowledgement = "";
    try {
      if (confirmation.kind === "remove") {
        const result = await request<{ userId: number; removedAt: string }>(
          requestScope,
          generation,
          `/api/work-hub/meetings/${encodeURIComponent(occurrenceRef.current)}/participants/${encodeURIComponent(String(confirmation.userId))}/remove`,
          { method: "POST", body: "{}" },
        );
        if (result.userId !== confirmation.userId || !result.removedAt) throw new Error("Invalid removal acknowledgement");
        acknowledgement = t("meetingWorkspace.removedAcknowledged", {
          defaultValue: `${confirmation.displayName} was removed from the live meeting. Prior contributions remain in the record.`,
          name: confirmation.displayName,
        });
      } else {
        const result = await request<{ ended: boolean }>(
          requestScope,
          generation,
          `/api/work-hub/meetings/${encodeURIComponent(occurrenceRef.current)}/end`,
          { method: "POST", body: "{}" },
        );
        if (result.ended !== true) throw new Error("Invalid end acknowledgement");
        acknowledgement = t("meetingWorkspace.endedAcknowledged", {
          defaultValue: "The meeting ended for everyone. The meeting record was retained.",
        });
        setEndedAcknowledgedScope(requestScope);
      }
      if (managementOwnerRef.current !== owner || scopeRef.current !== requestScope || lifecycleRef.current !== generation) return;
      managementConfirmationRef.current = null;
      setManagementConfirmation(null);
      setManagementNotice(acknowledgement);
      abortRequests();
      try {
        const next = await request<MeetingSnapshot>(
          requestScope,
          generation,
          `/api/work-hub/meetings/${encodeURIComponent(occurrenceRef.current)}/catch-up`,
        );
        if (managementOwnerRef.current !== owner || next.userId !== userId ||
          scopeRef.current !== requestScope || lifecycleRef.current !== generation) return;
        snapshotGenerationRef.current = generation;
        setStoredSnapshot({ scope: requestScope, generation, data: next });
        setAccessLostScope(null);
        setError("");
      } catch (cause) {
        if (isTerminal(cause)) {
          revoke(requestScope);
          return;
        }
        if (isAbort(cause) || managementOwnerRef.current !== owner || scopeRef.current !== requestScope ||
          lifecycleRef.current !== generation) return;
        managementRefreshFailedRef.current = true;
        setManagementRefreshFailed(true);
        setManagementNotice(`${acknowledgement} ${t("meetingWorkspace.errors.managementRefresh", { defaultValue: "Refresh to load the latest meeting details." })}`);
      }
    } catch (cause) {
      if (isTerminal(cause)) {
        revoke(requestScope);
        return;
      }
      if (isAbort(cause) || managementOwnerRef.current !== owner || scopeRef.current !== requestScope ||
        lifecycleRef.current !== generation) return;
      setManagementNotice(confirmation.kind === "remove"
        ? t("meetingWorkspace.errors.remove", { defaultValue: "The attendee was not removed. Try again." })
        : t("meetingWorkspace.errors.end", { defaultValue: "The meeting was not ended. Try again." }));
    } finally {
      if (managementOwnerRef.current === owner) {
        managementOwnerRef.current = null;
        if (mountedRef.current) setManagementPending(false);
      }
    }
  }, [abortRequests, request, revoke, t, userId]);

  const uploadPendingFile = useCallback(async (operation: PendingFile, inherited?: FileUploadOwnership) => {
    if ((!inherited && fileOwnerRef.current) || !snapshotRef.current || !activeRef.current ||
      operation.scope !== scopeRef.current || operation.generation !== lifecycleRef.current ||
      snapshotGenerationRef.current !== operation.generation || terminalScopesRef.current.has(operation.scope)) return;
    const owner = inherited?.owner ?? Symbol("meeting-file");
    const authScope = inherited?.authScope ?? captureAuthScope();
    const activity = inherited?.activity ?? createFileActivity(
      operation.scope, operation.generation, occurrenceRef.current, operation.recipientUserId, authScope,
    );
    const controller = new AbortController();
    fileOwnerRef.current = owner;
    fileActivityRef.current = activity;
    controllersRef.current.add(controller);
    setFileBusy(true);
    setFileError("");
    setFileNotice("");
    setFileRefreshFailed(false);
    try {
      if (!inherited) await activity.start();
      if (fileOwnerRef.current !== owner || !activeRef.current || scopeRef.current !== operation.scope ||
        lifecycleRef.current !== operation.generation || !isAuthScopeCurrent(authScope)) return;
      const acknowledgement = await uploadMeetingFile(occurrenceRef.current, operation.file, operation.recipientUserId, authScope, controller.signal);
      if (fileOwnerRef.current !== owner || scopeRef.current !== operation.scope ||
        lifecycleRef.current !== operation.generation || !isAuthScopeCurrent(authScope)) return;
      if (!acknowledgement?.attachment || acknowledgement.attachment.fileName !== operation.file.name ||
        acknowledgement.attachment.contentType !== operation.file.type || acknowledgement.attachment.byteSize !== operation.file.size)
        throw new Error("Invalid file acknowledgement");
      pendingFileRef.current = null;
      setFileNotice(t("meetingWorkspace.fileAdded", { defaultValue: "File added to the meeting." }));
      try {
        const next = await request<MeetingSnapshot>(operation.scope, operation.generation,
          `/api/work-hub/meetings/${encodeURIComponent(occurrenceRef.current)}/catch-up`);
        if (fileOwnerRef.current !== owner || next.userId !== userId || scopeRef.current !== operation.scope || lifecycleRef.current !== operation.generation) return;
        snapshotGenerationRef.current = operation.generation;
        setStoredSnapshot({ scope: operation.scope, generation: operation.generation, data: next });
      } catch (cause) {
        if (isTerminal(cause)) { revoke(operation.scope); return; }
        if (!isAbort(cause) && fileOwnerRef.current === owner && scopeRef.current === operation.scope) {
          setFileRefreshFailed(true);
          setFileNotice(t("meetingWorkspace.fileAddedRefresh", { defaultValue: "File added. Refresh to load it in the timeline." }));
        }
      }
    } catch (cause) {
      if (isTerminal(cause)) { revoke(operation.scope); return; }
      if (user && isOfflineWorkHubFailure(cause)) {
        const recipient = operation.recipientUserId === null ? "" : `?recipient=${encodeURIComponent(String(operation.recipientUserId))}`;
        const path = `/api/work-hub/meetings/${encodeURIComponent(occurrenceRef.current)}/files/${encodeURIComponent(operation.file.id)}${recipient}`;
        const uri = persistMeetingFileForOffline(operation.file);
        await queueNativeWorkHubUpload(user, path, uri, operation.file.type, [], { "x-file-name": encodeURIComponent(operation.file.name) }, true, operation.file.id);
        pendingFileRef.current = null;
        setFileNotice(t("meetingWorkspace.fileQueued", { defaultValue: "File saved securely on this device. It will send when you reconnect." }));
        return;
      }
      const status = (cause as ApiFailure | undefined)?.status;
      if (status && status >= 400 && status < 500 && status !== 408) pendingFileRef.current = null;
      if (!isAbort(cause) && fileOwnerRef.current === owner && scopeRef.current === operation.scope && lifecycleRef.current === operation.generation)
        setFileError(t("meetingWorkspace.errors.fileUpload", { defaultValue: "The file may not have finished uploading. Retry the same file." }));
    } finally {
      controllersRef.current.delete(controller);
      activity.stop();
      if (fileActivityRef.current === activity) fileActivityRef.current = null;
      if (fileOwnerRef.current === owner) {
        fileOwnerRef.current = null;
        if (mountedRef.current) setFileBusy(false);
      }
    }
  }, [createFileActivity, request, revoke, t, user, userId]);

  const chooseFile = useCallback(async (source: MeetingFileSource) => {
    const requestScope = scopeRef.current;
    const generation = lifecycleRef.current;
    if (fileOwnerRef.current || !snapshotRef.current || accessLost || !activeRef.current ||
      snapshotGenerationRef.current !== generation || terminalScopesRef.current.has(requestScope)) return;
    const audience = recipientRef.current;
    const chooser = Symbol("meeting-file-picker");
    const authScope = captureAuthScope();
    const activity = createFileActivity(requestScope, generation, occurrenceRef.current, audience, authScope);
    let handedOff = false;
    fileOwnerRef.current = chooser;
    fileActivityRef.current = activity;
    setFileBusy(true);
    setFileError("");
    setFileNotice("");
    setFileRefreshFailed(false);
    try {
      await activity.start();
      if (fileOwnerRef.current !== chooser || scopeRef.current !== requestScope || lifecycleRef.current !== generation ||
        !activeRef.current || !isAuthScopeCurrent(authScope)) return;
      const selected = await pickMeetingFile(source);
      if (fileOwnerRef.current !== chooser || scopeRef.current !== requestScope || lifecycleRef.current !== generation || !activeRef.current) return;
      if (!selected) return;
      const operation = { file: selected, recipientUserId: audience, scope: requestScope, generation };
      pendingFileRef.current = operation;
      handedOff = true;
      await uploadPendingFile(operation, { owner: chooser, activity, authScope });
    } catch (cause) {
      if (isTerminal(cause)) { revoke(requestScope); return; }
      if (!isAbort(cause) && fileOwnerRef.current === chooser && scopeRef.current === requestScope && lifecycleRef.current === generation) {
        const code = (cause as ApiFailure | undefined)?.code;
        const key = ({
          "permission.camera": "meetingWorkspace.errors.cameraPermission",
          "permission.photos": "meetingWorkspace.errors.photosPermission",
          "validation.unreadable": "meetingWorkspace.errors.fileUnreadable",
          "validation.empty": "meetingWorkspace.errors.fileEmpty",
          "validation.type": "meetingWorkspace.errors.fileType",
          "validation.size": "meetingWorkspace.errors.fileSize",
        } as Record<string, string>)[code ?? ""] ?? "meetingWorkspace.errors.fileRead";
        setFileError(t(key, { defaultValue: "That file could not be added. Choose a readable supported file no larger than 25 MB." }));
      }
    } finally {
      if (!handedOff) {
        activity.stop();
        if (fileActivityRef.current === activity) fileActivityRef.current = null;
      }
      if (!handedOff && fileOwnerRef.current === chooser) {
        fileOwnerRef.current = null;
        if (mountedRef.current) setFileBusy(false);
      }
    }
  }, [accessLost, createFileActivity, revoke, t, uploadPendingFile]);

  const retryFile = useCallback(async () => {
    const operation = pendingFileRef.current;
    if (operation) await uploadPendingFile(operation);
  }, [uploadPendingFile]);

  const openFile = useCallback(async (file: { id: string; recipientUserId: number | null; fileName: string; contentType: string; byteSize: number }) => {
    if (openOwnerRef.current) return;
    const owner = Symbol("meeting-file-open");
    openOwnerRef.current = owner;
    const requestScope = scopeRef.current;
    const generation = lifecycleRef.current;
    const authScope = captureAuthScope();
    const controller = new AbortController();
    const audience = recipientRef.current;
    controllersRef.current.add(controller);
    const assertCurrent = () => {
      if (!mountedRef.current || !activeRef.current || scopeRef.current !== requestScope || lifecycleRef.current !== generation ||
        snapshotGenerationRef.current !== generation || recipientRef.current !== audience ||
        !isAuthScopeCurrent(authScope) || controller.signal.aborted) throw abortError();
      const currentSnapshot = snapshotRef.current;
      const current = currentSnapshot?.chat.find((entry) => entry.id === file.id && entry.messageType === "attachment");
      const authorizedPair = audience === null
        ? current?.recipientUserId === null
        : current?.recipientUserId !== null && (
          (current?.userId === currentSnapshot?.userId && current?.recipientUserId === audience) ||
          (current?.userId === audience && current?.recipientUserId === currentSnapshot?.userId)
        );
      if (!current?.attachment || current.attachment.removedAt || current.recipientUserId !== file.recipientUserId || !authorizedPair)
        throw abortError();
    };
    setFileError("");
    try {
      assertCurrent();
      await downloadAndShareMeetingFile({ occurrenceId: occurrenceRef.current, fileId: file.id, fileName: file.fileName,
        contentType: file.contentType, byteSize: file.byteSize, authScope, assertCurrent, signal: controller.signal,
        registerTemporaryCleanup: (cleanup) => { if (scopeRef.current === requestScope && lifecycleRef.current === generation) fileCleanupRef.current = cleanup; else cleanup?.(); },
      });
    } catch (cause) {
      if (isTerminal(cause)) { revoke(requestScope); return; }
      if (!isAbort(cause) && scopeRef.current === requestScope && lifecycleRef.current === generation)
        setFileError(t("meetingWorkspace.errors.fileOpen", { defaultValue: "The file could not be opened. Refresh and try again." }));
    } finally {
      controllersRef.current.delete(controller);
      if (openOwnerRef.current === owner) {
        openOwnerRef.current = null;
        fileCleanupRef.current = null;
      }
    }
  }, [revoke, t]);

  return useMemo(() => ({
    snapshot,
    loading: loadingScope === scope,
    error,
    accessLost,
    recipientUserId,
    draft,
    sending,
    managementConfirmation,
    managementPending,
    managementNotice,
    managementRefreshFailed,
    meetingEndedAcknowledged: endedAcknowledgedScope === scope,
    fileBusy,
    fileError,
    fileNotice,
    fileRefreshFailed,
    fileRetryAvailable: Boolean(pendingFileRef.current?.scope === scope),
    now,
    selectRecipient,
    updateDraft,
    send,
    refresh,
    requestRemoveConfirmation,
    requestEndConfirmation,
    cancelManagement,
    confirmManagement,
    chooseFile,
    retryFile,
    openFile,
  }), [accessLost, cancelManagement, confirmManagement, draft, endedAcknowledgedScope, error, loadingScope,
    fileBusy, fileError, fileNotice, fileRefreshFailed, managementConfirmation, managementNotice, managementPending,
    managementRefreshFailed, now, openFile, recipientUserId, refresh, requestEndConfirmation, requestRemoveConfirmation,
    retryFile, scope, selectRecipient, send, sending, snapshot, updateDraft, chooseFile]);
}
