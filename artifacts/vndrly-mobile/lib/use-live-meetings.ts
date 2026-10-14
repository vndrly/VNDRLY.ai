import * as Crypto from "expo-crypto";
import { useEffect, useRef, useState, useCallback } from "react";
import { AppState } from "react-native";
import { apiFetch } from "./api";
import {
  captureAuthScope,
  isAuthScopeCurrent,
  subscribeUser,
  subscribeToken,
} from "./auth";
import { useAuth } from "@/hooks/use-auth";
import { mobileOwner } from "./work-hub-mobile";
import {
  workHubCommandResultSchema,
  LiveMeetingCommandResourceSchema,
} from "@workspace/api-zod";
export function useLiveMeetings<T>(path: string) {
  const { user } = useAuth();
  const key = [
    user?.id,
    user?.activeMembershipId,
    user?.vendorId,
    user?.partnerId,
  ].join(":");
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [unavailable, setUnavailable] = useState(false);
  const scope = useRef(captureAuthScope()),
    mounted = useRef(false),
    foreground = useRef(true),
    pending = useRef(false);
  const attempt = useRef<{ path: string; method: string; body: string } | null>(
    null,
  );
  const reload = useCallback(async () => {
    if (
      pending.current ||
      !mounted.current ||
      !foreground.current ||
      !isAuthScopeCurrent(scope.current)
    )
      return;
    pending.current = true;
    const requestScope = scope.current;
    try {
      const result = await apiFetch<T>(path, undefined, requestScope);
      if (mounted.current && isAuthScopeCurrent(requestScope)) {
        setData(result);
        setError("");
        setUnavailable(false);
      }
    } catch (e) {
      if (mounted.current && isAuthScopeCurrent(requestScope)) {
        setData(null);
        setError(e instanceof Error ? e.message : "Meeting unavailable");
        setUnavailable((e as { status?: number }).status === 404);
      }
    } finally {
      pending.current = false;
    }
  }, [path]);
  useEffect(() => {
    scope.current = captureAuthScope();
    mounted.current = true;
    setData(null);
    setError("");
    attempt.current = null;
    const invalidate = () => {
      if (!isAuthScopeCurrent(scope.current)) {
        mounted.current = false;
        setData(null);
        setError("Account changed. Reopen Meetings.");
        attempt.current = null;
      }
    };
    const a = subscribeUser(invalidate),
      b = subscribeToken(invalidate);
    foreground.current =
      AppState.currentState !== "background" &&
      AppState.currentState !== "inactive";
    const state = AppState.addEventListener("change", (value) => {
      foreground.current = value === "active";
      if (foreground.current) void reload();
    });
    void reload();
    const timer = setInterval(() => void reload(), 5000);
    return () => {
      mounted.current = false;
      a();
      b();
      state.remove();
      clearInterval(timer);
    };
  }, [key, reload]);
  const send = async (
    pathSuffix: string,
    payload: unknown,
    version: number | null,
    method = "POST",
  ) => {
    const owner = mobileOwner(user);
    if (
      !owner ||
      busy ||
      !mounted.current ||
      !isAuthScopeCurrent(scope.current)
    )
      throw Error("Current company required");
    if (attempt.current) {
      const original = JSON.parse(attempt.current.body);
      if (
        attempt.current.path !== pathSuffix ||
        attempt.current.method !== method ||
        JSON.stringify(original.payload) !== JSON.stringify(payload)
      ) {
        const message =
          "An earlier request has not been confirmed. Retry the original request first.";
        setError(message);
        throw Error(message);
      }
    }
    if (!attempt.current)
      attempt.current = {
        path: pathSuffix,
        method,
        body: JSON.stringify({
          operationId: Crypto.randomUUID(),
          owner,
          context: { kind: "organization", id: owner.id },
          payloadVersion: 1,
          expectedVersion: version,
          payload,
        }),
      };
    const request = attempt.current;
    const requestScope = scope.current;
    setBusy(true);
    setError("");
    try {
      const raw = await apiFetch<unknown>(
        request.path,
        { method: request.method, body: request.body },
        requestScope,
      );
      const result = workHubCommandResultSchema(
        LiveMeetingCommandResourceSchema,
      ).parse(raw);
      if (result.operationId !== JSON.parse(request.body).operationId)
        throw Error("Meeting operation could not be verified");
      if (!isAuthScopeCurrent(requestScope)) throw Error("Account changed");
      attempt.current = null;
      await reload();
      return result;
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status && status >= 400 && status < 500) attempt.current = null;
      if (mounted.current && isAuthScopeCurrent(requestScope))
        setError(
          e instanceof Error
            ? e.message
            : "Request could not be confirmed; retry original request.",
        );
      throw e;
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return {
    data,
    error,
    busy,
    reload,
    send,
    retryOriginal: () => {
      const original = attempt.current;
      if (!original) return Promise.reject(Error("No pending request"));
      const body = JSON.parse(original.body);
      return send(
        original.path,
        body.payload,
        body.expectedVersion,
        original.method,
      );
    },
    originalPayload: attempt.current
      ? JSON.parse(attempt.current.body).payload
      : null,
    unavailable,
    retrying: !!attempt.current,
    contextKey: key,
  };
}
