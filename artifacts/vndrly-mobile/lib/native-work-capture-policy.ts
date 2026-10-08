import { z } from "zod/v4";

export const NativeCaptureContextSchema = z.string().min(1).max(300);
export const NativeScanDraftSchema = z
  .object({
    source: z.literal("visionkit_document_scan"),
    reviewRequired: z.literal(true),
    canonicalSaved: z.literal(false),
    pages: z
      .array(
        z
          .object({
            fileId: z.uuid(),
            uri: z.string().startsWith("file://"),
            contentType: z.literal("image/jpeg"),
            byteSize: z
              .number()
              .int()
              .positive()
              .max(25 * 1024 * 1024),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            ocrText: z.string().max(20000),
            ocrTruncated: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(20)
      .refine(
        (pages) =>
          pages.reduce((sum, page) => sum + page.byteSize, 0) <=
          25 * 1024 * 1024,
        "native_scan_total_too_large",
      ),
  })
  .strict();
export const NativeSummaryDraftSchema = z
  .object({
    source: z.literal("foundation_models_on_device"),
    text: z.string().min(1).max(20000),
    reviewRequired: z.literal(true),
    canonicalSaved: z.literal(false),
  })
  .strict();
export const NativeUploadTransportSchema = z
  .object({
    jobId: z.uuid(),
    fileId: z.uuid(),
    contextBinding: NativeCaptureContextSchema,
    status: z.enum([
      "queued",
      "uploading",
      "transport_complete",
      "failed",
      "cancelled",
    ]),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    byteSize: z
      .number()
      .int()
      .positive()
      .max(25 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    canonicalSaved: z.literal(false),
    bytesSent: z.number().int().nonnegative().max(25 * 1024 * 1024).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.status !== "transport_complete" || value.httpStatus === 204,
    "native_transport_status_invalid",
  );
/** Only the existing signed upload transport; no bearer headers or arbitrary destinations. */
export function validateNativeUploadDestination(
  raw: string,
  canonicalOrigin: string,
  now = Date.now(),
) {
  const origin = new URL(canonicalOrigin),
    url = new URL(raw, origin);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    url.protocol !== "https:" ||
    url.origin !== origin.origin ||
    url.username ||
    url.password ||
    url.hash ||
    !/^\/api\/storage\/upload\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      url.pathname,
    )
  )
    throw new Error("native_upload_destination_invalid");
  const keys = [...url.searchParams.keys()];
  const expiry = Number(url.searchParams.get("expires"));
  if (
    keys.length !== 2 ||
    !keys.includes("expires") ||
    !keys.includes("signature") ||
    !Number.isSafeInteger(expiry) ||
    expiry <= now ||
    !/^\d+$/.test(url.searchParams.get("expires") ?? "") ||
    !/^[a-f0-9]{64}$/i.test(url.searchParams.get("signature") ?? "")
  )
    throw new Error("native_upload_signature_invalid");
  return url.toString();
}
export function readNativeTransport(
  raw: unknown,
  expected: {
    jobId: string;
    fileId: string;
    contextBinding: string;
    sha256: string;
  },
) {
  const value = NativeUploadTransportSchema.parse(raw);
  if (
    value.jobId !== expected.jobId ||
    value.fileId !== expected.fileId ||
    value.contextBinding !== expected.contextBinding ||
    value.sha256 !== expected.sha256
  )
    throw new Error("native_upload_context_changed");
  // This proves bytes transport only. The current authenticated API still must
  // finalize the private object and associate it with the reviewed work record.
  return value;
}
