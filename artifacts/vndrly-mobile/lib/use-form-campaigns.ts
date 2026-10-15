import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import { z } from "zod/v4";
import { workHubCommandResultSchema } from "@workspace/api-zod";
import { apiFetch } from "./api";
import {
  captureAuthScope,
  isAuthScopeCurrent,
  subscribeUser,
  subscribeToken,
} from "./auth";
import { mobileOwner, mobileCommandEnvelope } from "./work-hub-mobile";
import { useAuth } from "@/hooks/use-auth";
export function useFormCampaigns<T>(
  path: string,
  parse: (value: unknown) => T,
) {
  const { user } = useAuth(),
    owner = mobileOwner(user),
    key = [user?.id, user?.activeMembershipId, owner?.type, owner?.id].join(
      ":",
    );
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const scope = useRef(captureAuthScope()),
    mounted = useRef(false),
    pendingRead = useRef(new Set<string>()),
    currentView = useRef(`${key}:${path}`),
    dataView = useRef<string | null>(null),
    sending = useRef(false),
    foreground = useRef(true),
    parser = useRef(parse);
  parser.current = parse;
  currentView.current = `${key}:${path}`;
  const attempt = useRef<{
    path: string;
    body: string;
    method: string;
    scope: ReturnType<typeof captureAuthScope>;
    key: string;
    view: string;
  } | null>(null);
  const reload = useCallback(async () => {
    const view = `${key}:${path}`;
    if (
      !mounted.current ||
      pendingRead.current.has(view) ||
      !foreground.current ||
      currentView.current !== view
    )
      return;
    const current = scope.current;
    const readParser = parser.current;
    pendingRead.current.add(view);
    setLoading(true);
    try {
      const raw = await apiFetch<unknown>(path, undefined, current);
      if (
        mounted.current &&
        isAuthScopeCurrent(current) &&
        currentView.current === view
      ) {
        const parsed = readParser(raw);
        const match = path.match(/\/instances\/([^/]+)$/);
        if (
          match &&
          (parsed as { instanceId?: string }).instanceId !== match[1]
        )
          throw Error("Assigned form does not match this page");
        dataView.current = view;
        setData(parsed);
        setError("");
      }
    } catch (e) {
      if (
        mounted.current &&
        isAuthScopeCurrent(current) &&
        currentView.current === view
      ) {
        setData(null);
        setError(e instanceof Error ? e.message : "Campaign unavailable");
      }
    } finally {
      pendingRead.current.delete(view);
      if (
        mounted.current &&
        isAuthScopeCurrent(current) &&
        currentView.current === view
      )
        setLoading(false);
    }
  }, [path, key]);
  useEffect(() => {
    scope.current = captureAuthScope();
    mounted.current = true;
    attempt.current = null;
    setData(null);
    setError("");
    setBusy(false);
    const invalidate = () => {
      if (!isAuthScopeCurrent(scope.current)) {
        setData(null);
        setError("Account changed. Reopen this page.");
        attempt.current = null;
        mounted.current = false;
      }
    };
    const a = subscribeUser(invalidate),
      b = subscribeToken(invalidate),
      state = AppState.addEventListener("change", (s) => {
        foreground.current = s === "active";
        if (foreground.current) void reload();
      });
    foreground.current = !["inactive", "background"].includes(
      AppState.currentState ?? "active",
    );
    void reload();
    const interval = setInterval(() => void reload(), 15000);
    return () => {
      mounted.current = false;
      a();
      b();
      state.remove();
      clearInterval(interval);
    };
  }, [key, reload]);
  const send = async (
    target: string,
    payload: unknown,
    version?: number,
    method = "POST",
  ) => {
    if (
      !owner ||
      sending.current ||
      !mounted.current ||
      !isAuthScopeCurrent(scope.current)
    )
      throw Error("Current company required");
    if (
      attempt.current &&
      (attempt.current.path !== target ||
        attempt.current.method !== method ||
        JSON.stringify(JSON.parse(attempt.current.body).payload) !==
          JSON.stringify(payload))
    )
      throw Error("Retry the original unconfirmed request first.");
    if (!attempt.current)
      attempt.current = {
        path: target,
        body: JSON.stringify(
          mobileCommandEnvelope(
            owner,
            payload,
            version,
            { kind: "organization", id: owner.id },
            Crypto.randomUUID(),
          ),
        ),
        method,
        scope: scope.current,
        key,
        view: currentView.current,
      };
    const request = attempt.current;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const raw = await apiFetch<unknown>(
          request.path,
          { method: request.method, body: request.body },
          request.scope,
        ),
        result = workHubCommandResultSchema(
          z.record(z.string(), z.unknown()),
        ).parse(raw);
      if (result.operationId !== JSON.parse(request.body).operationId)
        throw Error("Saved operation could not be verified");
      if (
        !isAuthScopeCurrent(request.scope) ||
        request.view !== currentView.current
      )
        throw Error("Account changed");
      attempt.current = null;
      await reload();
      return result;
    } catch (e) {
      if (
        isAuthScopeCurrent(request.scope) &&
        mounted.current &&
        request.view === currentView.current
      ) {
        const status = (e as { status?: number }).status;
        if (status && status >= 400 && status < 500) attempt.current = null;
        setError(
          e instanceof Error
            ? e.message
            : "Request unconfirmed. Retry original request.",
        );
      }
      throw e;
    } finally {
      sending.current = false;
      if (
        isAuthScopeCurrent(request.scope) &&
        mounted.current &&
        request.view === currentView.current
      )
        setBusy(false);
    }
  };
  return {
    data: dataView.current === currentView.current ? data : null,
    error,
    busy,
    loading,
    reload,
    send,
    contextKey: key,
    uncertain: !!attempt.current,
    retryOriginal: () => {
      const request = attempt.current;
      if (!request) return Promise.reject(Error("No pending request"));
      const body = JSON.parse(request.body);
      return send(
        request.path,
        body.payload,
        body.expectedVersion ?? undefined,
        request.method,
      );
    },
  };
}
