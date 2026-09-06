import { createHash } from "node:crypto";
import type { SessionPayload } from "../lib/session";
import { organizationKeyFromSession } from "./askv-pending-confirmation";
import { DEFAULT_ASKV_REALTIME_MODEL } from "./realtime-session";
import { logger } from "../lib/logger";

export const VOICE_METRIC_EVENTS = [
  "session_start",
  "session_end",
  "first_audio",
  "turn",
  "interruption",
  "wake",
  "false_wake",
  "correction",
  "fallback",
  "idle",
] as const;
const REASONS = [
  "user",
  "timeout",
  "muted",
  "background",
  "network",
  "permission",
  "unavailable",
  "interruption",
  "empty_turn",
];
const TOKEN_KEYS = [
  "inputTextTokens",
  "inputAudioTokens",
  "cachedTextTokens",
  "cachedAudioTokens",
  "outputTextTokens",
  "outputAudioTokens",
] as const;
export type VoiceUsage = Record<(typeof TOKEN_KEYS)[number], number>;
export type VoiceMetric = {
  sessionId: string;
  conversationId?: number;
  eventId: string;
  event: (typeof VOICE_METRIC_EVENTS)[number];
  clientSurface: "web" | "ios";
  durationMs?: number;
  reason?: string;
  usage?: VoiceUsage;
};
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
export function parseVoiceMetric(value: unknown): VoiceMetric | null {
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          "sessionId",
          "conversationId",
          "eventId",
          "event",
          "clientSurface",
          "durationMs",
          "reason",
          "usage",
        ].includes(key),
    )
  )
    return null;
  if (
    !identifier(value.sessionId) ||
    !identifier(value.eventId) ||
    !(VOICE_METRIC_EVENTS as readonly unknown[]).includes(value.event) ||
    !["web", "ios"].includes(String(value.clientSurface))
  )
    return null;
  if (
    value.conversationId !== undefined &&
    (!Number.isSafeInteger(value.conversationId) ||
      Number(value.conversationId) <= 0)
  )
    return null;
  if (
    value.durationMs !== undefined &&
    (typeof value.durationMs !== "number" ||
      !Number.isFinite(value.durationMs) ||
      value.durationMs < 0 ||
      value.durationMs > 86_400_000)
  )
    return null;
  if (value.reason !== undefined && !REASONS.includes(String(value.reason)))
    return null;
  if (value.usage !== undefined) {
    const usage = value.usage;
    if (
      !object(usage) ||
      Object.keys(usage).some(
        (key) => !(TOKEN_KEYS as readonly string[]).includes(key),
      ) ||
      TOKEN_KEYS.some(
        (key) =>
          !Number.isSafeInteger(usage[key]) ||
          Number(usage[key]) < 0 ||
          Number(usage[key]) > 1_000_000,
      )
    )
      return null;
    if (
      Number(usage.cachedTextTokens) > Number(usage.inputTextTokens) ||
      Number(usage.cachedAudioTokens) > Number(usage.inputAudioTokens)
    )
      return null;
  }
  return value as VoiceMetric;
}

/** Published 2026-09-06 rates; estimate covers Realtime text/audio, not transcription.
 * https://developers.openai.com/api/docs/models/gpt-realtime-2.1
 * Unknown configured models retain usage with a null estimate; never invent a rate.
 */
export function estimateVoiceCost(
  usage: VoiceUsage | undefined,
  model: string,
): number | null {
  if (!usage || model !== "gpt-realtime-2.1") return null;
  return (
    ((usage.inputTextTokens - usage.cachedTextTokens) * 4 +
      (usage.inputAudioTokens - usage.cachedAudioTokens) * 32 +
      (usage.cachedTextTokens + usage.cachedAudioTokens) * 0.4 +
      usage.outputTextTokens * 24 +
      usage.outputAudioTokens * 64) /
    1_000_000
  );
}

const rates = new Map<number, { start: number; count: number }>();
export function allowVoiceMetric(userId: number, now = Date.now()): boolean {
  for (const [id, rate] of rates)
    if (rate.start < now - 60_000) rates.delete(id);
  const rate = rates.get(userId) ?? { start: now, count: 0 };
  if (++rate.count > 120) return false;
  rates.set(userId, rate);
  return true;
}
export async function recordVoiceMetric(
  session: SessionPayload,
  metric: VoiceMetric,
) {
  const { db, assistantActionAuditTable: table } =
    await import("@workspace/db");
  const { and, eq, sql } = await import("drizzle-orm");
  const hash = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const scopeHash = hash([
    session.userId,
    organizationKeyFromSession(session),
    metric.sessionId,
    metric.conversationId ?? null,
  ]);
  const actionType = `askv_voice_metric:${hash([scopeHash, metric.eventId])}`;
  const model =
    process.env.ASKV_REALTIME_MODEL?.trim() || DEFAULT_ASKV_REALTIME_MODEL;
  const estimatedCostUsd = estimateVoiceCost(metric.usage, model);
  const data = {
    event: metric.event,
    scopeHash,
    model,
    clientSurface: metric.clientSurface,
    ...(metric.durationMs !== undefined
      ? { durationMs: metric.durationMs }
      : {}),
    ...(metric.reason ? { reason: metric.reason } : {}),
    ...(metric.usage ? { usage: metric.usage } : {}),
    estimatedCostUsd,
  };
  const duplicate = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${actionType}, 0))`,
    );
    const [prior] = await tx
      .select({ id: table.id })
      .from(table)
      .where(
        and(
          eq(table.userId, session.userId!),
          eq(table.actionType, actionType),
        ),
      )
      .limit(1);
    if (prior) return true;
    await tx.insert(table).values({
      userId: session.userId!,
      actorRole: session.role ?? null,
      partnerId: session.partnerId ?? null,
      vendorId: session.vendorId ?? null,
      conversationId: metric.conversationId ?? null,
      clientSurface: metric.clientSurface,
      inputMode: metric.clientSurface === "ios" ? "ios_voice" : "web_voice",
      provider: "openai_realtime",
      toolName: "askv_voice_metric",
      actionType,
      parsedIntent: data,
      resultStatus: "success",
    });
    return false;
  });
  if (!duplicate)
    logger.info({ kind: "askv_voice_metric", ...data }, "AskV voice metric");
  return { ok: true, duplicate, estimatedCostUsd };
}

/** Server-owned outcomes complement client timing/usage observations. No inputs or output text. */
export function recordVoiceToolOutcome(args: {
  session: SessionPayload;
  sessionId: string;
  name: string;
  outcome:
    | "success"
    | "failure"
    | "denied"
    | "requires_confirmation"
    | "cancelled";
  duplicate?: boolean;
  durationMs?: number;
}) {
  const scopeHash = createHash("sha256")
    .update(
      JSON.stringify([
        args.session.userId,
        organizationKeyFromSession(args.session),
        args.sessionId,
      ]),
    )
    .digest("hex");
  logger.info(
    {
      kind: "askv_voice_tool",
      scopeHash,
      toolName: args.name,
      outcome: args.outcome,
      duplicate: args.duplicate ?? false,
      durationMs: args.durationMs ?? null,
    },
    "AskV voice tool outcome",
  );
}
