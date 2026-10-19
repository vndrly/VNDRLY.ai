import { z } from "zod/v4";
import {
  GateDailyBillingPostsSchema,
  GateDailyBillingSetupSchema,
  GateDailyBillingPreviewSchema,
  GateDailyBillingConfigureSchema,
  GateDailyBillingCloseSchema,
  GateDailyBillingConfigSchema,
  GateDailyBillingResultSchema,
  type GateDailyBillingPost,
  type GateDailyBillingSetup,
  type GateDailyBillingPreview,
  type GateDailyBillingConfigure,
  type GateDailyBillingClose,
  type GateDailyBillingResult,
} from "./gate-daily-billing";
export type GateBillingRequest = (
  path: string,
  init?: RequestInit,
) => Promise<unknown>;
export type GateBillingDraft = Omit<
  GateDailyBillingConfigure,
  "operationId" | "expectedVersion"
>;
type Pending =
  | { kind: "configure"; postId: string; body: GateDailyBillingConfigure }
  | { kind: "invoice_now"; postId: string; body: GateDailyBillingClose };
export type GateBillingWorkflowSnapshot = {
  busy: boolean;
  posts: GateDailyBillingPost[];
  nextCursor: string | null;
  postId: string;
  setup: GateDailyBillingSetup | null;
  preview: GateDailyBillingPreview | null;
  pending: Pending | null;
  result: GateDailyBillingResult | null;
  errorCode: string | null;
};
/** Shared web/native command controller. An unknown response retains the exact
 * original request; retry never makes a new operation, price or billing period.
 * No token, photo, document or client-authorized financial rate is stored here. */
export function createGateDailyBillingWorkflow(options: {
  request: GateBillingRequest;
  operationId: () => string;
}) {
  let state: GateBillingWorkflowSnapshot = {
      busy: false,
      posts: [],
      nextCursor: null,
      postId: "",
      setup: null,
      preview: null,
      pending: null,
      result: null,
      errorCode: null,
    },
    disposed = false;
  const listeners = new Set<() => void>(),
    controller = new AbortController();
  const publish = (value: Partial<GateBillingWorkflowSnapshot>) => {
    if (disposed) return;
    state = { ...state, ...value };
    for (const listener of listeners) listener();
  };
  const request = (path: string, init?: RequestInit) =>
    options.request(path, { ...init, signal: controller.signal });
  const code = (error: unknown) =>
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : error instanceof z.ZodError
        ? "gate_billing.response_unconfirmed"
        : "gate_billing.result_unconfirmed";
  const rejected = (error: unknown) =>
    Boolean(
      error &&
      typeof error === "object" &&
      "status" in error &&
      [400, 401, 403, 404, 409, 422].includes(Number(error.status)),
    );
  const unconfirmed = () =>
    Object.assign(new Error("Canonical billing readback did not match"), {
      code: "gate_billing.response_unconfirmed",
    });
  const readContext = async (postId: string) => {
    const setup = GateDailyBillingSetupSchema.parse(
      await request(`/gate-billing/${postId}/setup`),
    );
    const preview = setup.config
      ? GateDailyBillingPreviewSchema.parse(
          await request(`/gate-billing/${postId}/preview`),
        )
      : null;
    if (
      setup.post.id !== postId ||
      (setup.config &&
        (setup.config.stationId !== postId ||
          setup.config.siteId !== setup.post.siteId ||
          setup.config.partnerId !== setup.post.partnerId)) ||
      (preview &&
        (preview.config.stationId !== postId ||
          preview.config.vendorId !== setup.config?.vendorId))
    )
      throw unconfirmed();
    publish({ setup, preview });
    return { setup, preview };
  };
  const perform = async (pending: Pending) => {
    if (disposed || state.busy) return;
    publish({ busy: true, pending, errorCode: null, result: null });
    let received = false;
    try {
      const path = pending.kind === "configure" ? "configure" : "invoice-now",
        response = await request(`/gate-billing/${pending.postId}/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(pending.body),
        });
      received = true;
      const configured =
          pending.kind === "configure"
            ? GateDailyBillingConfigSchema.parse(response)
            : null,
        result =
          pending.kind === "invoice_now"
            ? GateDailyBillingResultSchema.parse(response)
            : null;
      // Read the current canonical period separately from the action response.
      const saved = await readContext(pending.postId),
        current = saved.setup.config;
      if (configured && (!current || current.version < configured.version))
        throw unconfirmed();
      if (
        result?.status === "submitted" &&
        (!current?.lastBilledThroughDay ||
          current.lastBilledThroughDay < result.billedThroughDay ||
          (current.lastBilledThroughDay === result.billedThroughDay &&
            result.nextTicketId !== null &&
            current.openTicketId !== result.nextTicketId))
      )
        throw unconfirmed();
      publish({ pending: null, result });
    } catch (error) {
      publish({
        errorCode: code(error),
        pending: !received && rejected(error) ? null : pending,
      });
    } finally {
      publish({ busy: false });
    }
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      disposed = true;
      controller.abort();
      listeners.clear();
    },
    load: async (after?: string) => {
      if (disposed || state.busy || state.pending) return;
      publish({ busy: true, errorCode: null });
      try {
        const page = GateDailyBillingPostsSchema.parse(
            await request(
              `/gate-billing/posts${after ? `?after=${encodeURIComponent(after)}` : ""}`,
            ),
          ),
          posts = after ? [...state.posts, ...page.items] : page.items,
          postId =
            state.postId ||
            (!after && page.items.length === 1 ? page.items[0].id : "");
        publish({ posts, nextCursor: page.nextCursor, postId });
        if (postId) await readContext(postId);
      } catch (error) {
        publish({ errorCode: code(error) });
      } finally {
        publish({ busy: false });
      }
    },
    select: async (postId: string) => {
      if (disposed || state.busy || state.pending) return;
      publish({
        busy: true,
        postId,
        setup: null,
        preview: null,
        result: null,
        errorCode: null,
      });
      try {
        await readContext(z.uuid().parse(postId));
      } catch (error) {
        publish({ errorCode: code(error) });
      } finally {
        publish({ busy: false });
      }
    },
    refresh: async () => {
      if (disposed || state.busy || state.pending || !state.postId) return;
      publish({ busy: true, errorCode: null });
      try {
        await readContext(state.postId);
      } catch (error) {
        publish({ errorCode: code(error) });
      } finally {
        publish({ busy: false });
      }
    },
    configure: async (draft: GateBillingDraft) => {
      if (disposed || state.busy || state.pending || !state.postId) return;
      try {
        const body = GateDailyBillingConfigureSchema.parse({
          ...draft,
          operationId: options.operationId(),
          expectedVersion: state.setup?.config?.version ?? 0,
        });
        await perform({ kind: "configure", postId: state.postId, body });
      } catch (error) {
        publish({
          errorCode:
            error instanceof z.ZodError
              ? "gate_billing.invalid_request"
              : code(error),
        });
      }
    },
    invoiceNow: async (continueBilling = true) => {
      if (disposed || state.busy || state.pending || !state.preview) return;
      const body = GateDailyBillingCloseSchema.parse({
        operationId: options.operationId(),
        expectedVersion: state.preview.config.version,
        previewFingerprint: state.preview.fingerprint,
        continueBilling,
        acknowledgeCoverageGaps: true,
        minimumCompletedDays: null,
      });
      await perform({ kind: "invoice_now", postId: state.postId, body });
    },
    retry: async () => {
      if (state.pending) await perform(state.pending);
    },
  };
}
