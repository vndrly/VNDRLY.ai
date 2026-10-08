import { makeCustodyAttempt, submitCustodyAttempt, CustodyAbsentConflict } from "@workspace/api-zod";
import { apiFetch } from "./api";
import { captureAuthScope, isAuthScopeCurrent, type StoredUser } from "./auth";
import { getNativeWorkHubQueueStore } from "./work-hub-queue-native";
import { createNativeOperationJournal, journalScopeKey, type JournalEntry, type JournalScope } from "./native-operation-journal";
export function nativeJournalScope(user: StoredUser): JournalScope {
  const membership = user.availableMemberships?.find(item => item.id === user.activeMembershipId);
  const scope = { userId: user.id, membershipId: user.activeMembershipId ?? 0, orgType: membership?.orgType ?? (user.partnerId ? "partner" : "vendor") as "vendor" | "partner", orgId: membership?.orgId ?? user.vendorId ?? user.partnerId ?? 0 };
  journalScopeKey(scope); return scope;
}
export async function enqueueNativeOperation(user: StoredUser, entry: Omit<JournalEntry, "state" | "attempts" | "resolution">) {
  return createNativeOperationJournal(await getNativeWorkHubQueueStore()).enqueue(nativeJournalScope(user), entry);
}
export async function readNativeJournal(user: StoredUser) {
  return createNativeOperationJournal(await getNativeWorkHubQueueStore()).inspect(nativeJournalScope(user));
}
export async function synchronizeNativeJournal(user: StoredUser) {
  const scope = captureAuthScope();
  const current = () => isAuthScopeCurrent(scope);
  return createNativeOperationJournal(await getNativeWorkHubQueueStore()).flush(nativeJournalScope(user), async entry => {
    if (!current()) throw Object.assign(new Error("Account changed"), { status: 403 });
    if (entry.domain === "custody") {
      const raw = entry.payload as { fingerprint: string };
      const { fingerprint, ...values } = raw;
      try { await submitCustodyAttempt(makeCustodyAttempt(values, fingerprint), (path, init) => apiFetch(path, init, scope), current); }
      catch (error) { if (error instanceof CustodyAbsentConflict) throw Object.assign(error, { status: 409 }); throw error; }
      return;
    }
    if (entry.domain === "gate") {
      const input = entry.payload as Record<string, unknown>;
      const saved = await apiFetch<{ id: number; reconciliationState?: string; reconciliationFacts?: { operationId?: { value: string; source: string } } }>("/api/visits/gate/observations", { method: "POST", body: JSON.stringify({ ...input, operationId: entry.operationId, observedAt: entry.capturedAt, source: "gatekeeper" }) }, scope);
      if (!Number.isInteger(saved.id) || saved.reconciliationFacts?.operationId?.value !== entry.operationId) throw new Error("Gate observation canonical receipt is unverified");
      return;
    }
    const input = entry.payload as { path: string; method: "POST" | "PATCH"; command: { operationId: string } };
    if (!/^\/api\/work-hub\/channels\/[0-9a-f-]{36}\/notes(?:\/[0-9a-f-]{36})?$/.test(input.path) || input.command.operationId !== entry.operationId) throw Object.assign(new Error("Invalid authorized note route"), { status: 400 });
    await apiFetch(input.path, { method: input.method, body: JSON.stringify(input.command) }, scope);
  });
}
