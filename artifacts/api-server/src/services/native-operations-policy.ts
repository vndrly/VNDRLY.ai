import { z } from "zod/v4";
export const dutyModes = ["manual", "ticket", "scheduled"] as const;
export const NativePolicySchema = z
  .object({
    enabled: z.boolean().default(true),
    locationRequests: z.boolean().default(true),
    photoRequests: z.boolean().default(true),
    automaticArrival: z.boolean().default(false),
    usageAlertUsd: z.number().positive().default(25),
    usageAlertTokens: z.number().int().positive().default(1000000),
    dutyModes: z.array(z.enum(dutyModes)).default([...dutyModes]),
    approvedAiProviders: z
      .array(z.enum(["anthropic", "openai"]))
      .default(["anthropic", "openai"]),
    grants: z
      .array(
        z.object({
          requesterUserId: z.number().int().positive(),
          workerUserId: z.number().int().positive(),
          siteId: z.number().int().positive().optional(),
          ticketId: z.number().int().positive().optional(),
        }),
      )
      .max(200)
      .default([]),
    requestHistoryDays: z.literal(365).default(365),
    diagnosticDays: z.literal(90).default(90),
    supportGrants: z
      .array(
        z
          .object({
            userId: z.number().int().positive(),
            purpose: z.string().trim().min(1).max(300),
            expiresAt: z.iso.datetime(),
            workerUserIds: z.array(z.number().int().positive()).min(1).max(100),
            siteIds: z.array(z.number().int().positive()).max(100).default([]),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    escalation: z
      .object({
        assignedContactUserId: z
          .number()
          .int()
          .positive()
          .nullable()
          .default(null),
        backupContactUserId: z
          .number()
          .int()
          .positive()
          .nullable()
          .default(null),
        intervalMinutes: z.number().int().min(1).max(1440).default(15),
      })
      .strict()
      .default({
        assignedContactUserId: null,
        backupContactUserId: null,
        intervalMinutes: 15,
      }),
  })
  .strict();
export type NativePolicy = z.infer<typeof NativePolicySchema>;
export type NativeDuty = {
  active: boolean;
  mode: (typeof dutyModes)[number] | null;
  startedAt: string | null;
  endsAt: string | null;
  ticketId: number | null;
  shiftId: string | null;
  overrideEndedAt: string | null;
};
export type NativeState = {
  consent: { locationSharing: boolean; automaticArrival?: boolean };
  designatedDeviceId: string | null;
  bindingVersion: number;
  duty: NativeDuty;
  lastLocation?: LocationObservation;
  onCallWindows?: { startsAt: string; endsAt: string; consent: true }[];
};
export type LocationObservation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
};
export type NativeRequest = {
  id: string;
  kind: "location" | "photo";
  workerUserId: number;
  vendorId: number;
  requesterUserId: number;
  requesterOrgType: "vendor" | "partner";
  requesterOrgId: number;
  siteId: number | null;
  ticketId: number | null;
  purpose: string;
  createdAt: string;
  expiresAt: string;
  bindingVersion: number;
  deviceId: string | null;
  state: string;
  allowLibrary: boolean;
  idempotencyKey: string;
  result: Record<string, unknown> | null;
  uploadStartedAt?: string;
  upload?: {
    objectPath: string;
    checksumSha256: string;
    byteSize: number;
    contentType: string;
  };
};
export const initialNativeState = (): NativeState => ({
  consent: { locationSharing: false, automaticArrival: false },
  designatedDeviceId: null,
  bindingVersion: 0,
  duty: {
    active: false,
    mode: null,
    startedAt: null,
    endsAt: null,
    ticketId: null,
    shiftId: null,
    overrideEndedAt: null,
  },
});
export class NativeOperationError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}
export function effectiveDuty(duty: NativeDuty, now: number): boolean {
  return duty.active && (!duty.endsAt || Date.parse(duty.endsAt) > now);
}
export function requestExpiry(
  kind: "location" | "photo",
  now: number,
  shiftEnd: string | null,
) {
  return new Date(
    kind === "location"
      ? now + 45_000
      : Math.min(
          now + 8 * 3600_000,
          shiftEnd ? Date.parse(shiftEnd) : Infinity,
        ),
  ).toISOString();
}
export function locationEligibility(
  state: NativeState,
  online: boolean,
  now: number,
): string | null {
  if (!effectiveDuty(state.duty, now)) return "off_duty";
  if (!state.consent.locationSharing) return "sharing_off";
  if (!state.designatedDeviceId) return "no_work_phone";
  if (!online) return "phone_unavailable";
  return null;
}
export function validateFreshLocation(
  location: LocationObservation,
  request: NativeRequest,
  now: number,
) {
  const captured = Date.parse(location.capturedAt);
  if (
    !Number.isFinite(captured) ||
    captured < Date.parse(request.createdAt) ||
    captured > now + 5000 ||
    now - captured > 60_000 ||
    location.accuracy > 500
  )
    throw new NativeOperationError("native.location_stale_or_inaccurate");
}
export function responseDisposition(
  request: NativeRequest,
  state: NativeState,
  deviceId: string,
  version: number,
  now: number,
  next: string,
) {
  if (
    ["saved", "declined", "unavailable", "cancelled"].includes(request.state)
  ) {
    if (request.state === next) return "replay";
    throw new NativeOperationError("native.request_terminal");
  }
  const oldUpload =
    request.kind === "photo" &&
    request.uploadStartedAt &&
    next === "saved" &&
    request.deviceId === deviceId &&
    request.bindingVersion === version;
  if (
    !oldUpload &&
    (state.designatedDeviceId !== deviceId || state.bindingVersion !== version)
  )
    throw new NativeOperationError("native.work_phone_changed");
  if (now >= Date.parse(request.expiresAt) && !oldUpload)
    throw new NativeOperationError("native.request_expired");
  if (
    request.kind === "location" &&
    (!effectiveDuty(state.duty, now) || !state.consent.locationSharing)
  )
    throw new NativeOperationError("native.location_sharing_unavailable");
  return oldUpload && now >= Date.parse(request.expiresAt) ? "late" : "valid";
}

export const NativeRequestInputSchema = z
  .object({
    workerUserId: z.number().int().positive(),
    vendorId: z.number().int().positive(),
    kind: z.enum(["location", "photo"]),
    siteId: z.number().int().positive().optional(),
    ticketId: z.number().int().positive().optional(),
    purpose: z.string().trim().min(1).max(500),
    idempotencyKey: z.uuid(),
    allowLibrary: z.boolean().optional(),
  })
  .strict();
export const NativeResponseInputSchema = z
  .object({
    deviceId: z.uuid(),
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
    noteId: z.number().int().positive().optional(),
    operationId: z.uuid().optional(),
    objectPath: z
      .string()
      .regex(/^\/objects\/uploads\/[0-9a-f-]{36}$/i)
      .optional(),
    photoSource: z.enum(["camera", "library"]).optional(),
    photoCapturedAt: z.iso.datetime().optional(),
    declineReason: z
      .enum(["unsafe_now", "inaccessible_subject", "wrong_ticket", "other"])
      .optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export function nativeDutyContactAvailable(st: NativeState, now: number) {
  return (
    effectiveDuty(st.duty, now) ||
    Boolean(
      st.onCallWindows?.some(
        (w) =>
          w.consent &&
          Date.parse(w.startsAt) <= now &&
          Date.parse(w.endsAt) > now,
      ),
    )
  );
}
