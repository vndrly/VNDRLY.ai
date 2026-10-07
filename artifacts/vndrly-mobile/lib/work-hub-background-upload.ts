import { z } from "zod/v4";
import {
  NativeCaptureAccountSchema,
  nativeCaptureBinding,
  type NativeCaptureAccount,
} from "./native-capture-context-policy";
import { readNativeTransport } from "./native-work-capture-policy";
const owner = z
  .object({
    type: z.enum(["vendor", "partner"]),
    id: z.number().int().positive(),
  })
  .strict();
const reservePayload = z
  .object({
    scope: z.enum(["personal", "company", "channel"]),
    channelId: z.uuid().optional(),
    fileName: z.string().min(1).max(255),
    contentType: z.string().min(1).max(120),
    byteSize: z
      .number()
      .int()
      .positive()
      .max(25 * 1024 * 1024),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const BackgroundUploadPendingSchema = z
  .object({
    account: NativeCaptureAccountSchema,
    staged: z
      .object({
        fileId: z.uuid(),
        uri: z.string().startsWith("file://").max(1500),
        byteSize: z
          .number()
          .int()
          .positive()
          .max(25 * 1024 * 1024),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    jobId: z.uuid(),
    finalizeOperationId: z.uuid(),
    reserve: z
      .object({
        operationId: z.uuid(),
        owner,
        context: z
          .object({
            kind: z.literal("organization"),
            id: z.number().int().positive(),
          })
          .strict(),
        payloadVersion: z.literal(1),
        expectedVersion: z.null(),
        payload: reservePayload,
      })
      .strict(),
    reserved: z
      .object({
        documentId: z.uuid(),
        fileId: z.uuid(),
        objectPath: z.string().min(1).max(1000),
        uploadURL: z.string().min(1).max(3000),
      })
      .strict()
      .nullable(),
    reserveSent: z.boolean(),
    transportComplete: z.boolean(),
    finalizeSent: z.boolean(),
    canonicalSaved: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.reserve.context.id !== value.reserve.owner.id ||
      value.staged.sha256 !== value.reserve.payload.checksumSha256 ||
      value.staged.byteSize !== value.reserve.payload.byteSize ||
      ((value.transportComplete ||
        value.finalizeSent ||
        value.canonicalSaved) &&
        !value.reserved)
    )
      ctx.addIssue({ code: "custom", message: "Upload binding mismatch" });
    if (
      value.reserve.payload.scope !== "channel" &&
      (value.reserve.owner.type !== value.account.orgType ||
        value.reserve.owner.id !== value.account.orgId)
    )
      ctx.addIssue({ code: "custom", message: "Account owner mismatch" });
    if (
      value.reserve.payload.scope === "channel" &&
      !value.reserve.payload.channelId
    )
      ctx.addIssue({ code: "custom", message: "Channel required" });
  });
export type BackgroundUploadPending = z.infer<
  typeof BackgroundUploadPendingSchema
>;
export type BackgroundUploadOutcome = {
  state: "uploading" | "transported" | "saved" | "failed" | "cancelled";
  documentId: string | null;
};
type Dependencies = {
  current(): boolean;
  fresh(): Promise<NativeCaptureAccount>;
  persist(value: BackgroundUploadPending): Promise<void>;
  reserve(body: BackgroundUploadPending["reserve"]): Promise<unknown>;
  readTransport(value: BackgroundUploadPending): Promise<unknown | null>;
  startTransport(value: BackgroundUploadPending): Promise<unknown>;
  readSaved(value: BackgroundUploadPending): Promise<boolean>;
  finalize(body: ReturnType<typeof finalizeBody>): Promise<unknown>;
};
export function finalizeBody(value: BackgroundUploadPending) {
  if (!value.reserved) throw new Error("upload_not_reserved");
  return {
    operationId: value.finalizeOperationId,
    owner: value.reserve.owner,
    context: value.reserve.context,
    payloadVersion: 1,
    expectedVersion: null,
    payload: { id: value.reserved.documentId, fileId: value.reserved.fileId },
  };
}
/** Every network stage retains exact immutable identifiers. Native 204 is transport only. */
export async function progressBackgroundUpload(
  raw: BackgroundUploadPending,
  deps: Dependencies,
): Promise<BackgroundUploadOutcome> {
  const value = BackgroundUploadPendingSchema.parse(raw);
  const check = () => {
    if (!deps.current()) throw new Error("native_work_capture_account_changed");
  };
  const fresh = async () => {
    check();
    const account = await deps.fresh();
    check();
    if (nativeCaptureBinding(account) !== nativeCaptureBinding(value.account))
      throw new Error("native_work_capture_account_changed");
  };
  const persist = async () => {
    check();
    await deps.persist(value);
    check();
  };
  await fresh();
  if (value.canonicalSaved) {
    const visible = await deps.readSaved(value);
    check();
    if (!visible) throw new Error("upload_saved_visibility_unavailable");
    return { state: "saved", documentId: value.reserved!.documentId };
  }
  if (!value.reserved) {
    value.reserveSent = true;
    await persist();
    const response = z
      .object({
        operationId: z.uuid(),
        appliedAt: z.string(),
        resource: BackgroundUploadPendingSchema.shape.reserved.unwrap(),
      })
      .parse(await deps.reserve(value.reserve));
    check();
    if (response.operationId !== value.reserve.operationId)
      throw new Error("upload_receipt_mismatch");
    value.reserved = response.resource;
    await persist();
  }
  if (value.finalizeSent) {
    const saved = await deps.readSaved(value);
    check();
    if (saved) {
      value.canonicalSaved = true;
      await persist();
      return { state: "saved", documentId: value.reserved.documentId };
    }
  }
  if (!value.transportComplete) {
    const recorded = await deps.readTransport(value);
    check();
    const result = recorded ?? (await deps.startTransport(value));
    check();
    const transport = readNativeTransport(result, {
      jobId: value.jobId,
      fileId: value.staged.fileId,
      contextBinding: nativeCaptureBinding(value.account),
      sha256: value.staged.sha256,
    });
    if (transport.byteSize !== value.staged.byteSize)
      throw new Error("upload_bytes_mismatch");
    if (transport.status === "failed" || transport.status === "cancelled")
      return { state: transport.status, documentId: value.reserved.documentId };
    if (transport.status !== "transport_complete")
      return { state: "uploading", documentId: value.reserved.documentId };
    value.transportComplete = true;
    await persist();
  }
  await fresh();
  value.finalizeSent = true;
  await persist();
  const response = z
    .object({
      operationId: z.uuid(),
      appliedAt: z.string(),
      resource: z.object({
        id: z.uuid(),
        orgType: z.string(),
        orgId: z.number(),
        createdBy: z.number(),
        data: z.object({
          currentFileId: z.uuid(),
          contentType: z.string(),
          byteSize: z.number(),
          versions: z.array(z.uuid()),
        }),
      }),
    })
    .parse(await deps.finalize(finalizeBody(value)));
  check();
  const doc = response.resource;
  if (
    response.operationId !== value.finalizeOperationId ||
    doc.id !== value.reserved.documentId ||
    doc.orgType !== value.reserve.owner.type ||
    doc.orgId !== value.reserve.owner.id ||
    doc.createdBy !== value.account.userId ||
    doc.data.currentFileId !== value.reserved.fileId ||
    !doc.data.versions.includes(value.reserved.fileId) ||
    doc.data.contentType !== value.reserve.payload.contentType ||
    doc.data.byteSize !== value.staged.byteSize
  )
    throw new Error("upload_receipt_mismatch");
  value.canonicalSaved = true;
  await persist();
  const visible = await deps.readSaved(value);
  check();
  if (!visible) throw new Error("upload_saved_visibility_unavailable");
  return { state: "saved", documentId: doc.id };
}
