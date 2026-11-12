import { z } from "zod/v4";

// Client suggestions are never crossing proof. The server supplies receipt time
// and the recording actor when the gatekeeper confirms the crossing.
export const gateCaptureInput = z.object({
  images: z.array(z.object({
    objectPath: z.string().regex(/^\/objects\/uploads\/[0-9a-f-]{36}$/i),
    originalPath: z.string().regex(/^\/objects\/uploads\/[0-9a-f-]{36}$/i),
    kind: z.enum(["plate", "vehicle", "crop"]),
    capturedAt: z.iso.datetime(),
  }).strict()).max(12).default([]),
  arrivalRunId: z.uuid().optional(),
}).strict();
