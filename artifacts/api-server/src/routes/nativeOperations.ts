import { nativeSupportService } from "../services/native-support";
import { prepareNativeTicketPhotoUpload } from "../services/native-ticket-photo-upload";
import { absoluteUploadUrl } from "../lib/uploadUrl";
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { getSessionFromRequest } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import { nativeOperationsService } from "../services/native-operations";
import {
  NativeOperationError,
  NativePolicySchema,
} from "../services/native-operations-policy";
const router: IRouter = Router(),
  uuid = z.uuid(),
  id = z.number().int().positive();
const request = z
  .object({
    workerUserId: id,
    vendorId: id,
    kind: z.enum(["location", "photo"]),
    siteId: id.optional(),
    ticketId: id.optional(),
    purpose: z.string().trim().min(1).max(500),
    idempotencyKey: uuid,
    allowLibrary: z.boolean().optional(),
  })
  .strict();
const response = z
  .object({
    deviceId: uuid,
    bindingVersion: z.number().int().nonnegative(),
    state: z.enum([
      "opened",
      "upload-in-progress",
      "saved",
      "declined",
      "unavailable",
    ]),
    location: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        accuracy: z.number().nonnegative(),
        capturedAt: z.iso.datetime(),
      })
      .strict()
      .optional(),
    noteId: id.optional(),
    operationId: uuid.optional(),
    objectPath: z.string().max(512).optional(),
    photoSource: z.enum(["camera", "library"]).optional(),
    photoCapturedAt: z.iso.datetime().optional(),
    declineReason: z
      .enum(["unsafe_now", "inaccessible_subject", "wrong_ticket", "other"])
      .optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
router.use("/native-operations", (req, res, next) => {
  if (!getSessionFromRequest(req)?.userId)
    return sendApiError(
      res,
      401,
      "auth.unauthenticated",
      "Authentication required",
    );
  return next();
});
function handler(fn: (req: any) => Promise<unknown>) {
  return async (req: any, res: any) => {
    try {
      return res.json(await fn(req));
    } catch (e) {
      if (e instanceof z.ZodError)
        return sendApiError(
          res,
          400,
          "native.invalid_payload",
          "Invalid native operation",
        );
      if (e instanceof NativeOperationError)
        return sendApiError(res, e.status, e.code, e.message);
      throw e;
    }
  };
}
router.put(
  "/native-operations/task",
  handler((req) =>
    nativeOperationsService.task(
      getSessionFromRequest(req)!,
      z
        .object({
          kind: z.enum(["ticket", "gate", "fleet"]),
          id: z.string().min(1).max(100),
        })
        .strict()
        .parse(req.body),
    ),
  ),
);
router.put(
  "/native-operations/on-call",
  handler((req) =>
    nativeOperationsService.onCall(getSessionFromRequest(req)!, req.body),
  ),
);
router.post(
  "/native-operations/requests/:id/acknowledge",
  handler((req) =>
    nativeOperationsService.acknowledge(
      getSessionFromRequest(req)!,
      uuid.parse(req.params.id),
    ),
  ),
);
router.post(
  "/native-operations/diagnostics",
  handler((req) =>
    nativeOperationsService.diagnostics(getSessionFromRequest(req)!, req.body),
  ),
);
router.get(
  "/native-operations/support/vendors/:vendorId",
  handler((req) =>
    nativeSupportService.technical(
      getSessionFromRequest(req)!,
      id.parse(Number(req.params.vendorId)),
    ),
  ),
);
router.get(
  "/native-operations/support/vendors/:vendorId/requests/:requestId",
  handler((req) =>
    nativeSupportService.request(
      getSessionFromRequest(req)!,
      id.parse(Number(req.params.vendorId)),
      uuid.parse(req.params.requestId),
    ),
  ),
);
router.post(
  "/native-operations/requests/:id/photo-upload",
  handler(async (req) => {
    const result = await nativeOperationsService.photoUpload(
      getSessionFromRequest(req)!,
      uuid.parse(req.params.id),
      req.body,
    );
    return { ...result, uploadURL: absoluteUploadUrl(req, result.uploadURL) };
  }),
);
router.get(
  "/native-operations/status",
  handler((req) => nativeOperationsService.status(getSessionFromRequest(req)!)),
);
router.get(
  "/native-operations/policy",
  handler((req) => nativeOperationsService.policy(getSessionFromRequest(req)!)),
);
router.put(
  "/native-operations/policy",
  handler((req) =>
    nativeOperationsService.policy(
      getSessionFromRequest(req)!,
      NativePolicySchema.parse(req.body),
    ),
  ),
);
router.put(
  "/native-operations/consent",
  handler((req) =>
    nativeOperationsService.consent(
      getSessionFromRequest(req)!,
      z
        .object({
          locationSharing: z.boolean(),
          automaticArrival: z.boolean().optional(),
        })
        .strict()
        .parse(req.body),
    ),
  ),
);
router.put(
  "/native-operations/device",
  handler((req) =>
    nativeOperationsService.device(
      getSessionFromRequest(req)!,
      z.object({ deviceId: uuid }).strict().parse(req.body).deviceId,
    ),
  ),
);
router.post(
  "/native-operations/duty",
  handler((req) =>
    nativeOperationsService.duty(
      getSessionFromRequest(req)!,
      z
        .object({
          action: z.enum(["start", "end"]),
          mode: z.enum(["manual", "ticket", "scheduled"]).default("manual"),
          ticketId: id.optional(),
          shiftId: uuid.optional(),
        })
        .strict()
        .parse(req.body),
    ),
  ),
);
router.get(
  "/native-operations/requests",
  handler((req) => nativeOperationsService.list(getSessionFromRequest(req)!)),
);
router.post(
  "/native-operations/requests",
  handler((req) =>
    nativeOperationsService.request(
      getSessionFromRequest(req)!,
      request.parse(req.body),
    ),
  ),
);
router.get(
  "/native-operations/requests/:id",
  handler((req) =>
    nativeOperationsService.read(
      getSessionFromRequest(req)!,
      uuid.parse(req.params.id),
    ),
  ),
);
router.post(
  "/native-operations/requests/:id/respond",
  handler((req) =>
    nativeOperationsService.respond(
      getSessionFromRequest(req)!,
      uuid.parse(req.params.id),
      response.parse(req.body),
    ),
  ),
);
router.post(
  "/native-operations/tickets/:ticketId/photo-upload",
  handler(async (req) => {
    const result = await prepareNativeTicketPhotoUpload(
      getSessionFromRequest(req)!,
      id.parse(Number(req.params.ticketId)),
      req.body,
    );
    return { ...result, uploadURL: absoluteUploadUrl(req, result.uploadURL) };
  }),
);
export default router;

router.post(
  "/native-operations/shifts/:id/respond",
  handler((req) =>
    nativeOperationsService.shiftResponse(
      getSessionFromRequest(req)!,
      uuid.parse(req.params.id),
      req.body,
    ),
  ),
);
