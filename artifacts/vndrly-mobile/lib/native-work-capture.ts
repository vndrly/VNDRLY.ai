import { z } from "zod/v4";
import { Platform } from "react-native";
import NativeCapture from "../modules/vndrly-work-capture/src/VndrlyWorkCaptureModule";
import { subscribeToken, subscribeUser } from "./auth";
import { currentNativeCaptureContext } from "./native-capture-context";
import {
  NativeScanDraftSchema,
  NativeSummaryDraftSchema,
} from "./native-work-capture-policy";

let listening = false;
function requireCapture() {
  if (Platform.OS !== "ios" || !NativeCapture)
    throw new Error("native_work_capture_unavailable");
  if (!listening) {
    listening = true;
    const invalidate = () => {
      void NativeCapture?.setContext(null).catch(() => undefined);
    };
    subscribeToken(invalidate);
    subscribeUser(invalidate);
  }
  return NativeCapture;
}

async function currentCapture() {
  const native = requireCapture();
  const context = await currentNativeCaptureContext(undefined, true);
  await native.setContext(context.binding);
  context.assertCurrent();
  return {
    native,
    binding: context.binding,
    assertCurrent: context.assertCurrent,
  };
}

export async function scanWorkDocumentDraft() {
  const context = await currentCapture();
  const result = await context.native.scanDocument(context.binding);
  try {
    context.assertCurrent();
    return NativeScanDraftSchema.parse(result);
  } catch (error) {
    await context.native
      .discardDraft({
        contextBinding: context.binding,
        fileIds: stagedScanFileIds(result),
      })
      .catch(() => undefined);
    throw error;
  }
}

export async function summarizeWorkDraft(text: string, language: "en" | "es") {
  if (!text.trim() || text.length > 20000)
    throw new Error("native_work_draft_input_invalid");
  const context = await currentCapture();
  const result = await context.native.summarizeDraft({
    contextBinding: context.binding,
    text,
    language,
  });
  context.assertCurrent();
  // This is local review text only. Saving uses the original domain workflow.
  return NativeSummaryDraftSchema.parse(result);
}
export async function transcribeLocalWorkDraft(uri: string, language: "en-US" | "es-ES") {
  const context = await currentCapture();
  const result = await context.native.transcribeLocalDraft({ contextBinding: context.binding, uri, language });
  context.assertCurrent();
  return z.object({ source: z.literal("speech_on_device"), text: z.string().min(1).max(20000), reviewRequired: z.literal(true), canonicalSaved: z.literal(false) }).strict().parse(result);
}

function stagedScanFileIds(raw: unknown): string[] {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("pages" in raw) ||
    !Array.isArray(raw.pages)
  )
    return [];
  return [
    ...new Set(
      raw.pages.slice(0, 20).flatMap((page: unknown) => {
        if (!page || typeof page !== "object" || !("fileId" in page)) return [];
        const parsed = z.uuid().safeParse(page.fileId);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
  ];
}

export async function scanWorkTextDraft() {
  const context = await currentCapture();
  const raw = await context.native.scanDocument(context.binding);
  const discard = () =>
    context.native.discardDraft({
      contextBinding: context.binding,
      fileIds: stagedScanFileIds(raw),
    });
  let result;
  try {
    context.assertCurrent();
    result = NativeScanDraftSchema.parse(raw);
  } catch (error) {
    await discard().catch(() => undefined);
    throw error;
  }
  // Remove the owned scan drafts before exposing a text-only result. A cleanup
  // failure is unavailable, not a claim that the images were removed.
  try {
    await discard();
  } catch {
    throw new Error("native_work_capture_cleanup_failed");
  }
  context.assertCurrent();
  return {
    text: result.pages
      .map((page) => page.ocrText)
      .join("\n\n")
      .slice(0, 20000),
    truncated:
      result.pages.some((page) => page.ocrTruncated) ||
      result.pages.reduce((size, page) => size + page.ocrText.length + 2, 0) >
        20000,
    source: result.source,
    reviewRequired: true as const,
    canonicalSaved: false as const,
  };
}
