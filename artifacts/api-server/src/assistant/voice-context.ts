import type { SessionPayload } from "../lib/session";
import {
  isVoiceWorkflow,
  voiceWorkflowForPath,
  type VoiceWorkflow,
} from "./tool-packs";

export type VoiceLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
};
export function compactVoiceLocation(value: unknown): VoiceLocation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.latitude !== "number" ||
    !Number.isFinite(v.latitude) ||
    Math.abs(v.latitude) > 90 ||
    typeof v.longitude !== "number" ||
    !Number.isFinite(v.longitude) ||
    Math.abs(v.longitude) > 180
  )
    return null;
  return {
    latitude: v.latitude,
    longitude: v.longitude,
    ...(typeof v.accuracyMeters === "number" &&
    Number.isFinite(v.accuracyMeters) &&
    v.accuracyMeters >= 0 &&
    v.accuracyMeters <= 100_000
      ? { accuracyMeters: v.accuracyMeters }
      : {}),
  };
}
export function compactVoicePath(value: unknown): string {
  if (typeof value !== "string") return "";
  const path = value.split(/[?#]/, 1)[0];
  return path.length <= 300 &&
    /^\/[a-zA-Z0-9/_().-]*$/.test(path) &&
    !path.includes("..")
    ? path
    : "";
}
export function compactVoiceContext(
  session: SessionPayload,
  context: {
    path: string;
    entityId: number | null;
    workflow?: VoiceWorkflow;
    location?: VoiceLocation | null;
  },
) {
  const path = compactVoicePath(context.path);
  const workflow =
    isVoiceWorkflow(context.workflow) && context.workflow !== "auto"
      ? context.workflow
      : voiceWorkflowForPath(path);
  return {
    path,
    entityId:
      context.entityId &&
      Number.isSafeInteger(context.entityId) &&
      context.entityId > 0
        ? context.entityId
        : null,
    workflow,
    role: ["admin", "partner", "vendor", "field_employee"].includes(
      session.role ?? "",
    )
      ? session.role
      : "any",
    organization: {
      vendorId: session.vendorId ?? null,
      partnerId: session.partnerId ?? null,
      activeMembershipId: session.activeMembershipId ?? null,
    },
    ...(context.location
      ? { location: compactVoiceLocation(context.location) }
      : {}),
  };
}
export function naturalVoiceEnabledForUser(userId: number): boolean {
  if (
    ["0", "false", "off"].includes(
      process.env.ASKV_NATURAL_VOICE_ENABLED?.trim().toLowerCase() ?? "",
    )
  )
    return false;
  const pilot = process.env.ASKV_NATURAL_VOICE_USER_IDS?.trim();
  return !pilot || pilot.split(",").some((id) => id.trim() === String(userId));
}
