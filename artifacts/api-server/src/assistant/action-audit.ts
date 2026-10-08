import { assistantActionAuditTable, db } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import type { AskVAuditTarget } from "./tool-registry";

export type AskVClientSurface = "ios" | "web" | "api";
export type AskVInputMode = "ios_voice" | "web_voice" | "web_text" | "ios_text";
export type AskVProvider = "openai_realtime" | "anthropic" | "openai_tts" | "chatgpt_mcp" | "openai_responses";

export interface WriteAskVActionAuditArgs {
  session: SessionPayload;
  clientSurface: AskVClientSurface;
  inputMode: AskVInputMode;
  provider: AskVProvider;
  toolName: string;
  actionType?: string;
  targetType?: AskVAuditTarget | null;
  targetId?: string | number | null;
  transcriptText?: string | null;
  parsedIntent?: unknown;
  toolInput?: unknown;
  toolOutput?: unknown;
  confidence?: number | null;
  confirmationPhrase?: string | null;
  gps?: {
    latitude?: number | null;
    longitude?: number | null;
    accuracyMeters?: number | null;
  } | null;
  resultStatus: "success" | "failure" | "requires_confirmation" | "cancelled";
  errorCode?: string | null;
  errorMessage?: string | null;
}

const RAW_AUDIO_KEY = /audio|pcm|wav|webm|base64/i;

export function excludeRawAudio(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => excludeRawAudio(item));
  if (!value || typeof value !== "object") return value;
  const cleaned: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (RAW_AUDIO_KEY.test(key)) continue;
    cleaned[key] = excludeRawAudio(child);
  }
  return cleaned;
}

function jsonOrNull(value: unknown): unknown | null {
  if (value == null) return null;
  return excludeRawAudio(value);
}

function numericOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function writeAskVActionAudit(args: WriteAskVActionAuditArgs): Promise<void> {
  await db.insert(assistantActionAuditTable).values({
    userId: args.session.userId ?? null,
    actorRole: args.session.role ?? null,
    actorMembershipRole: args.session.membershipRole ?? null,
    partnerId: args.session.partnerId ?? null,
    vendorId: args.session.vendorId ?? null,
    vendorPeopleId: args.session.vendorPeopleId ?? null,
    clientSurface: args.clientSurface,
    inputMode: args.inputMode,
    provider: args.provider,
    toolName: args.toolName,
    actionType: args.actionType ?? args.toolName,
    targetType: args.targetType ?? null,
    targetId: args.targetId == null ? null : String(args.targetId),
    transcriptText: args.transcriptText ?? null,
    parsedIntent: jsonOrNull(args.parsedIntent),
    toolInput: jsonOrNull(args.toolInput),
    toolOutput: jsonOrNull(args.toolOutput),
    confidence: args.confidence ?? null,
    confirmationPhrase: args.confirmationPhrase ?? null,
    gpsLatitude: numericOrNull(args.gps?.latitude),
    gpsLongitude: numericOrNull(args.gps?.longitude),
    gpsAccuracyMeters: numericOrNull(args.gps?.accuracyMeters),
    resultStatus: args.resultStatus,
    errorCode: args.errorCode ?? null,
    errorMessage: args.errorMessage ?? null,
  });
}
