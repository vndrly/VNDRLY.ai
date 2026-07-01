import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, desc, ne, inArray, lte, sql } from "drizzle-orm";
import {
  db,
  assistantConversationsTable,
  assistantMessagesTable,
  usersTable,
  onboardingProgressTable,
  invoicesTable,
  ticketsTable,
  partnersTable,
  vendorsTable,
  vendorPeopleTable,
} from "@workspace/db";
import { isNull } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { Anthropic } from "@workspace/integrations-anthropic-ai/sdk";
import { getSessionFromRequest, type SessionPayload } from "../lib/session";
import { logger } from "../lib/logger";
import { selectDocs, selectSignupDocs, type KnowledgeRole } from "../assistant/knowledge";
import {
  buildSystemPrompt,
  buildSignupSystemPrompt,
  composeAssistantMessages,
} from "../assistant/prompts/system";
import {
  REQUIRED_STEPS as REQUIRED_STEPS_DATA,
  STEP_KEYS as STEP_KEYS_DATA,
  STEP_REQUIRED_FIELDS as STEP_REQUIRED_FIELDS_DATA,
  PAYLOAD_TOP_KEYS as PAYLOAD_TOP_KEYS_DATA,
  getPayloadPath as getPayloadPathShared,
  isPayloadFieldFilled as isPayloadFieldFilledShared,
  validateStepCompletion,
  validateFieldPath,
} from "../assistant/onboarding-validation";
import {
  gateDeepLinkScreen,
  clampMetricsDays,
} from "../assistant/permissions";
import { buildDeepLink } from "../assistant/deep-links";
import { ensureDeepLinksInAssistantReply } from "../assistant/deep-link-markdown";
import { parsePageContext } from "../assistant/page-context";
import { classifyRefusal } from "../assistant/refusal";
import { TOOLS } from "../assistant/tools";
import { isDataTool, runDataTool } from "../assistant/data-tools";
import { isWriteTool, runWriteTool } from "../assistant/write-tools";
import {
  consumeDailyBudget,
  getClientIp,
  getSignupAssistantUsage,
  recordIpHit,
  recordSignupAssistantDigestHit,
} from "../lib/signup-assistant-rate-limit";
import { markdownToSpeechText, transcribeAudioBuffer } from "../lib/openai-whisper";
import { normalizeBuiltInTtsVoice, synthesizeSpeechBuffer } from "../lib/openai-tts";

const router: IRouter = Router();

// Claude model used for all assistant turns. The skill template recommends
// `claude-sonnet-4-5` as a current high-quality choice.
const MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 2048;
// We loop tool_use rounds up to this many times per request to prevent
// runaway tool chains. In practice 2-3 is enough for the wizard flows.
const MAX_TOOL_ROUNDS = 6;
// Cap how many prior turns we resend to Claude per request. The system
// prompt + knowledge slices already account for most context; messages
// are mostly the back-and-forth.
const MAX_PRIOR_MESSAGES = 24;

/**
 * Resolve the language that should drive the token-mode assistant's
 * priming envelope from a `vendor_people` row.
 *
 * Token-mode handles invitees who haven't finished set-password yet,
 * so there is no `users` row and `users.preferred_language` (the
 * canonical post-auth source) is unavailable. The public onboarding
 * page persists the English/Español toggle to
 * `vendor_people.preferred_language`, and this helper normalises that
 * column into the shape `composeAssistantMessages` expects:
 *
 *   "es" → Spanish primer is emitted on every turn (including the
 *          very first), per the Task #474 fix
 *   "en" → no primer (English is Claude's default reply language)
 *   null → no primer (toggle was never touched on this invite)
 *
 * Anything else is treated as null defensively, so a stale or
 * corrupted column value can never cause the assistant to crash.
 */
export function tokenModePreferredLanguage(
  employee: { preferredLanguage?: string | null },
): "en" | "es" | null {
  return employee.preferredLanguage === "en" || employee.preferredLanguage === "es"
    ? employee.preferredLanguage
    : null;
}

// ─────────────────────────────────────────────────────────────────
// Auth helpers
// ─────────────────────────────────────────────────────────────────
function requireSession(req: Request, res: Response): SessionPayload | null {
  const session = getSessionFromRequest(req);
  if (!session?.userId) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return null;
  }
  return session;
}

function normalizeRole(role: string | null | undefined): KnowledgeRole {
  if (role === "admin" || role === "partner" || role === "vendor" || role === "field_employee") {
    return role;
  }
  return "any";
}

// ─────────────────────────────────────────────────────────────────
// CRUD endpoints for conversation history
// ─────────────────────────────────────────────────────────────────
router.get("/assistant/conversations", async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const rows = await db
    .select({
      id: assistantConversationsTable.id,
      title: assistantConversationsTable.title,
      createdAt: assistantConversationsTable.createdAt,
      updatedAt: assistantConversationsTable.updatedAt,
    })
    .from(assistantConversationsTable)
    .where(eq(assistantConversationsTable.userId, session.userId!))
    .orderBy(desc(assistantConversationsTable.updatedAt))
    .limit(50);
  res.json({ conversations: rows });
});

// Rolling persistence cap. Each user's chat history is bounded so the
// table doesn't grow unboundedly: oldest conversations beyond the cap
// are pruned (with their messages cascading via FK on-delete) on every
// new conversation insert. The message-per-conversation cap is
// enforced after each assistant turn finishes (see persist-and-prune
// at the end of handleConversationMessage).
const MAX_CONVERSATIONS_PER_USER = 25;
const MAX_MESSAGES_PER_CONVERSATION = 200;

async function pruneOldConversations(userId: number): Promise<void> {
  // Find the conversations beyond the cap (ordered oldest first by
  // updatedAt) and delete them. Messages cascade-delete via the FK
  // declared in lib/db/src/schema/assistantMessages.ts.
  const all = await db
    .select({ id: assistantConversationsTable.id })
    .from(assistantConversationsTable)
    .where(eq(assistantConversationsTable.userId, userId))
    .orderBy(desc(assistantConversationsTable.updatedAt));
  if (all.length <= MAX_CONVERSATIONS_PER_USER) return;
  const toDelete = all.slice(MAX_CONVERSATIONS_PER_USER).map((r) => r.id);
  if (toDelete.length === 0) return;
  await db.delete(assistantConversationsTable).where(inArray(assistantConversationsTable.id, toDelete));
}

async function pruneOldMessages(conversationId: number): Promise<void> {
  // Keep the most recent N messages per conversation. Oldest messages
  // are dropped — the model's context cap (MAX_PRIOR_MESSAGES) is a
  // separate, lower number so this only affects very long sessions.
  const all = await db
    .select({ id: assistantMessagesTable.id })
    .from(assistantMessagesTable)
    .where(eq(assistantMessagesTable.conversationId, conversationId))
    .orderBy(desc(assistantMessagesTable.createdAt));
  if (all.length <= MAX_MESSAGES_PER_CONVERSATION) return;
  const toDelete = all.slice(MAX_MESSAGES_PER_CONVERSATION).map((r) => r.id);
  if (toDelete.length === 0) return;
  await db.delete(assistantMessagesTable).where(inArray(assistantMessagesTable.id, toDelete));
}

// Single-message body cap mirrors the per-turn cap on
// `/assistant/conversations/:id/messages` so a seed-history adoption
// can never carry a message larger than what a normal turn would.
const MAX_MESSAGE_LEN = 4000;

// Hard cap on how many turns a client can seed in one request. The
// pre-auth signup chat is capped to MAX_PRIOR_MESSAGES on the wire
// (the model only ever sees that many turns at once), so anything
// beyond it would be silently ignored on the next turn anyway. We
// reuse the same number to avoid surprising the user with a
// "we kept N but lost M" experience.
const MAX_SEED_HISTORY = MAX_PRIOR_MESSAGES;

/**
 * Validate and normalise an inbound `seedHistory` payload from
 * `POST /assistant/conversations`. The seed comes from the
 * unauthenticated signup-mode chat which we hand off to the
 * authenticated panel after the visitor signs in (Task #480).
 *
 * Defensive on purpose:
 *   - Drops any non-object entries.
 *   - Restricts roles to `user`/`assistant` (no `system`/`tool` rows).
 *   - Trims content; drops empty rows so we never persist blanks.
 *   - Caps each message at MAX_MESSAGE_LEN so a single oversized turn
 *     can't bypass the per-message limit on the messages route.
 *   - Caps the total to MAX_SEED_HISTORY for the same reason as the
 *     prior-history slice in `handleConversationMessage`.
 *
 * Returns `null` when nothing usable survived. Exported so the
 * regression suite can pin the exact contract the route relies on.
 */
export function normalizeSeedHistory(
  raw: unknown,
): Array<{ role: "user" | "assistant"; content: string }> | null {
  if (!Array.isArray(raw)) return null;
  const cleaned: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const trimmed = content.trim();
    if (!trimmed) continue;
    cleaned.push({
      role,
      content: trimmed.length > MAX_MESSAGE_LEN ? trimmed.slice(0, MAX_MESSAGE_LEN) : trimmed,
    });
  }
  if (cleaned.length === 0) return null;
  // Keep the most recent N turns so the model sees the freshest
  // context (matches how `handleConversationMessage` slices `tail`).
  return cleaned.slice(-MAX_SEED_HISTORY);
}

router.post("/assistant/conversations", async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  // Optional `seedHistory` lets a brand-new conversation be created
  // pre-populated with messages the visitor exchanged with the
  // pre-auth signup-mode assistant. The route adopts those rows into
  // a real conversation so the model has context on the next turn.
  // Anything malformed is dropped silently — the conversation is
  // still created so the panel never gets stuck on a 400 over a
  // best-effort hand-off.
  const seedHistory = normalizeSeedHistory(req.body?.seedHistory);

  // Auto-title from the first user message in the seed so the
  // sidebar entry is recognisable (matches the auto-title behaviour
  // in handleConversationMessage on the very first turn). Falls back
  // to the generic placeholder when there's no seed.
  const titleSource = seedHistory?.find((m) => m.role === "user")?.content;
  const initialTitle = titleSource
    ? titleSource.length > 60
      ? titleSource.slice(0, 57) + "…"
      : titleSource
    : "New conversation";

  const [row] = await db
    .insert(assistantConversationsTable)
    .values({ userId: session.userId!, title: initialTitle })
    .returning();

  if (seedHistory && seedHistory.length > 0) {
    // Persist the prior turns in order. All rows in this batch insert
    // share the exact same `now()` timestamp on Postgres, so the
    // read-side queries that load this conversation (the GET handler
    // above and the prior-turns load before sending to the model) MUST
    // tie-break on the monotonic `serial` primary key — otherwise the
    // visitor's adopted history would replay scrambled. Both readers
    // do `ORDER BY created_at, id`; keep them in lock-step.
    await db.insert(assistantMessagesTable).values(
      seedHistory.map((m) => ({
        conversationId: row.id,
        role: m.role,
        content: m.content,
      })),
    );
    // Bump updatedAt so the new conversation sorts to the top of the
    // sidebar list immediately, just like a regular turn would.
    await db
      .update(assistantConversationsTable)
      .set({ updatedAt: new Date() })
      .where(eq(assistantConversationsTable.id, row.id));
  }

  // Best-effort retention prune. Failure here mustn't block conversation
  // creation — log and continue so the user always gets their chat.
  pruneOldConversations(session.userId!).catch((err) =>
    logger.warn({ err, userId: session.userId }, "pruneOldConversations failed"),
  );
  res.status(201).json({
    id: row.id,
    title: initialTitle,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    seededMessageCount: seedHistory?.length ?? 0,
  });
});

router.get("/assistant/conversations/:id", async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" }); return; }
  const [conv] = await db
    .select()
    .from(assistantConversationsTable)
    .where(and(eq(assistantConversationsTable.id, id), eq(assistantConversationsTable.userId, session.userId!)))
    .limit(1);
  if (!conv) { res.status(404).json({ error: "Not found", code: "common.not_found" }); return; }
  // Order by createdAt with `id` as a stable tie-breaker. Seeded
  // pre-auth chats (Task #480) are batch-inserted in a single
  // statement, so multiple rows can share the exact same `created_at`
  // — without an `id` tie-break, Postgres is free to return them in
  // any order, which would scramble the visitor's adopted history.
  const msgs = await db
    .select()
    .from(assistantMessagesTable)
    .where(eq(assistantMessagesTable.conversationId, id))
    .orderBy(assistantMessagesTable.createdAt, assistantMessagesTable.id);
  res.json({
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    messages: msgs.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls ?? [],
      feedbackRating: m.feedbackRating ?? null,
      createdAt: m.createdAt,
    })),
  });
});

router.delete("/assistant/conversations/:id", async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" }); return; }
  const result = await db
    .delete(assistantConversationsTable)
    .where(and(eq(assistantConversationsTable.id, id), eq(assistantConversationsTable.userId, session.userId!)))
    .returning({ id: assistantConversationsTable.id });
  if (result.length === 0) { res.status(404).json({ error: "Not found", code: "common.not_found" }); return; }
  res.status(204).end();
});

// ─────────────────────────────────────────────────────────────────
// Admin telemetry: simple usage metrics for the dashboard card.
// ─────────────────────────────────────────────────────────────────
// Returns a roll-up of assistant traffic over the last `days` (default
// 7, max 90). Admin-only — partner/vendor/field roles get 403. Numbers
// come from `assistant_conversations` + `assistant_messages` (no extra
// telemetry table). Cheap aggregations only — no per-message payload
// scanning — so it stays sub-100ms even on a chatty week.
router.get("/assistant/metrics", async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  if (session.role !== "admin") {
    res.status(403).json({ error: "Admin only", code: "auth.admin_only" });
    return;
  }
  // Single source of truth for the days clamp (default 7, max 90).
  // Tested in artifacts/vndrly/tests/assistant.spec.ts.
  const days = clampMetricsDays(req.query.days);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Per-day buckets keyed by yyyy-mm-dd (UTC). Postgres date_trunc
  // would be ideal but we get the same result with TO_CHAR which
  // works the same across local/prod databases.
  const dayKey = sql<string>`to_char(${assistantConversationsTable.createdAt}, 'YYYY-MM-DD')`;
  const sessionsByDay = await db
    .select({ day: dayKey, count: sql<number>`count(*)::int` })
    .from(assistantConversationsTable)
    .where(sql`${assistantConversationsTable.createdAt} >= ${since}`)
    .groupBy(dayKey)
    .orderBy(dayKey);

  const msgDayKey = sql<string>`to_char(${assistantMessagesTable.createdAt}, 'YYYY-MM-DD')`;
  const messagesByDay = await db
    .select({ day: msgDayKey, count: sql<number>`count(*)::int` })
    .from(assistantMessagesTable)
    .where(sql`${assistantMessagesTable.createdAt} >= ${since}`)
    .groupBy(msgDayKey)
    .orderBy(msgDayKey);

  // Refusals only counted on assistant rows (the heuristic only ever
  // sets the column on assistant turns). count() always returns one
  // row but we still guard with `?? 0` so an unexpected empty result
  // can't 500 the dashboard.
  const refusalRows = await db
    .select({ refusalCount: sql<number>`count(*)::int` })
    .from(assistantMessagesTable)
    .where(sql`${assistantMessagesTable.createdAt} >= ${since} AND ${assistantMessagesTable.refusal} = true`);
  const refusalCount = refusalRows[0]?.refusalCount ?? 0;

  const feedbackRows = await db.execute<{
    helpful_count: number;
    unhelpful_count: number;
  }>(sql`
    SELECT
      count(*) FILTER (WHERE feedback_rating = 'helpful')::int AS helpful_count,
      count(*) FILTER (WHERE feedback_rating = 'unhelpful')::int AS unhelpful_count
    FROM assistant_messages
    WHERE created_at >= ${since}
      AND role = 'assistant'
      AND feedback_rating IS NOT NULL
  `);
  const feedbackResult: Array<{ helpful_count: number; unhelpful_count: number }> =
    Array.isArray(feedbackRows)
      ? (feedbackRows as Array<{ helpful_count: number; unhelpful_count: number }>)
      : ((feedbackRows as { rows?: Array<{ helpful_count: number; unhelpful_count: number }> }).rows ?? []);
  const helpfulCount = feedbackResult[0]?.helpful_count ?? 0;
  const unhelpfulCount = feedbackResult[0]?.unhelpful_count ?? 0;
  const feedbackCount = helpfulCount + unhelpfulCount;

  // TTFT stats — average + p95 — over assistant rows that recorded a
  // first-token timestamp. The percentile_cont aggregate is a stock
  // Postgres function so this works on the dev and prod DBs alike.
  // Drizzle's `execute` returns either an array OR a result-object
  // with `.rows` depending on the underlying driver, so we normalize
  // before reading the first row.
  const ttftRaw = await db.execute<{
    avg_ms: number | null;
    p95_ms: number | null;
    sample: number;
  }>(sql`
    SELECT
      avg(first_token_ms)::int AS avg_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY first_token_ms)::int AS p95_ms,
      count(first_token_ms)::int AS sample
    FROM assistant_messages
    WHERE created_at >= ${since} AND first_token_ms IS NOT NULL
  `);
  const ttftRows: Array<{ avg_ms: number | null; p95_ms: number | null; sample: number }> =
    Array.isArray(ttftRaw)
      ? (ttftRaw as Array<{ avg_ms: number | null; p95_ms: number | null; sample: number }>)
      : ((ttftRaw as { rows?: Array<{ avg_ms: number | null; p95_ms: number | null; sample: number }> }).rows ?? []);
  const ttft = ttftRows[0];

  // Onboarding completion — all-time, by org type. We count distinct
  // partner/vendor/vendorPeople rows in onboarding_progress that have a
  // non-null completedAt. Cheap: there are at most a few thousand.
  const completedByOrg = await db
    .select({
      orgType: onboardingProgressTable.orgType,
      count: sql<number>`count(*)::int`,
    })
    .from(onboardingProgressTable)
    .where(sql`${onboardingProgressTable.completedAt} IS NOT NULL`)
    .groupBy(onboardingProgressTable.orgType);

  // Pre-auth signup-assistant call volume + abuse-control state for
  // the current UTC day. Backed by `signup_assistant_counters` (see
  // `lib/signup-assistant-rate-limit`), so the count survives a
  // server restart and stays accurate across replicas. Surfaces
  // today's anonymous chat call count against the daily budget so
  // admins notice abuse early.
  const signupAssistant = await getSignupAssistantUsage();

  res.json({
    rangeDays: days,
    since: since.toISOString(),
    sessionsByDay,
    messagesByDay,
    refusalCount,
    helpfulCount,
    unhelpfulCount,
    feedbackCount,
    ttftMs: {
      avg: ttft?.avg_ms ?? null,
      p95: ttft?.p95_ms ?? null,
      sample: ttft?.sample ?? 0,
    },
    completedOnboardingByOrg: completedByOrg,
    signupAssistant: {
      dayKey: signupAssistant.dayKey,
      todayUsed: signupAssistant.used,
      todayBudget: signupAssistant.budget,
      activeIpBuckets: signupAssistant.activeIpBuckets,
      ipMax: signupAssistant.ipMax,
      ipWindowMs: signupAssistant.ipWindowMs,
    },
  });
});

// Record thumbs-up/down on a persisted assistant turn. Session chat
// only — anonymous token/signup modes never get DB message ids.
router.post("/assistant/messages/:id/feedback", async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const messageId = Number(req.params.id);
  if (!Number.isFinite(messageId)) {
    res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" });
    return;
  }
  const rating = req.body?.rating;
  if (rating !== "helpful" && rating !== "unhelpful") {
    res.status(400).json({ error: "Invalid rating", code: "assistant.invalid_feedback_rating" });
    return;
  }

  const rows = await db
    .select({
      messageId: assistantMessagesTable.id,
      role: assistantMessagesTable.role,
      ownerUserId: assistantConversationsTable.userId,
    })
    .from(assistantMessagesTable)
    .innerJoin(
      assistantConversationsTable,
      eq(assistantMessagesTable.conversationId, assistantConversationsTable.id),
    )
    .where(eq(assistantMessagesTable.id, messageId))
    .limit(1);
  const row = rows[0];
  if (!row || row.ownerUserId !== session.userId) {
    res.status(404).json({ error: "Not found", code: "common.not_found" });
    return;
  }
  if (row.role !== "assistant") {
    res.status(400).json({ error: "Only assistant turns can be rated", code: "assistant.feedback_assistant_only" });
    return;
  }

  await db
    .update(assistantMessagesTable)
    .set({ feedbackRating: rating })
    .where(eq(assistantMessagesTable.id, messageId));

  res.json({ ok: true, rating });
});

// Tool definitions visible to Claude live in `../assistant/tools.ts`
// so the eval suite (and any future consumer) can import the *exact*
// catalog the production route advertises without dragging in this
// whole router. Tool _execution_ stays here in `runTool` below, where
// every write tool re-checks the session's role + scope before
// mutating any row.

// Per-role allow lists for `deep_link_to`. Mirrors the role-gated
// routing in artifacts/vndrly/src/App.tsx so the assistant can never
// hand the user a link they can't actually open. Admins get every
// screen; partners/vendors get the screens they have a sidebar entry
// for; field employees get only the field portal + the ticket detail
// they can land on from the field portal. Onboarding screens are open
// to everyone (the page itself enforces the right persona).
//
// `null` for the "any" / unknown role bucket means "no gate" so we
// never block on an unrecognised role — defence-in-depth, the
// individual tool branches still gate by role.
// ROLE_ALLOWED_SCREENS now lives in `../assistant/permissions` so the
// regression test catalog can exercise the same map/gate the runtime
// reads here. See `gateDeepLinkScreen` for the single check.

// `buildDeepLink` lives in `../assistant/deep-links` so the role-gating
// lint in artifacts/vndrly/tests/assistant.spec.ts consumes the same
// URL-to-screen map this route reads. Adding a new screen there
// automatically feeds both the runtime and the lint — see
// DEEP_LINK_SCREENS in that module.

// ─────────────────────────────────────────────────────────────────
// Onboarding progress helpers (subset of what /onboarding does, but
// re-implemented here so the assistant doesn't have to make HTTP
// requests against itself).
// ─────────────────────────────────────────────────────────────────
type OrgScope = { orgType: "partner" | "vendor" | "field_employee"; partnerId: number | null; vendorId: number | null; vendorPeopleId: number | null };

function scopeFromSession(session: SessionPayload): OrgScope | null {
  if (session.role === "partner" && session.partnerId) {
    return { orgType: "partner", partnerId: session.partnerId, vendorId: null, vendorPeopleId: null };
  }
  if (session.role === "vendor" && session.vendorId) {
    return { orgType: "vendor", partnerId: null, vendorId: session.vendorId, vendorPeopleId: null };
  }
  if (session.role === "field_employee" && session.vendorPeopleId) {
    return { orgType: "field_employee", partnerId: null, vendorId: null, vendorPeopleId: session.vendorPeopleId };
  }
  return null;
}

function defaultStepFor(scope: OrgScope): string {
  if (scope.orgType === "field_employee") return "personal-info";
  return "company-basics";
}

async function ensureProgress(scope: OrgScope) {
  const where = scope.orgType === "partner"
    ? eq(onboardingProgressTable.partnerId, scope.partnerId!)
    : scope.orgType === "vendor"
    ? eq(onboardingProgressTable.vendorId, scope.vendorId!)
    : eq(onboardingProgressTable.vendorPeopleId, scope.vendorPeopleId!);
  const [existing] = await db.select().from(onboardingProgressTable).where(where).limit(1);
  if (existing) return existing;
  const [row] = await db
    .insert(onboardingProgressTable)
    .values({
      orgType: scope.orgType,
      partnerId: scope.partnerId,
      vendorId: scope.vendorId,
      vendorPeopleId: scope.vendorPeopleId,
      currentStep: defaultStepFor(scope),
    })
    .returning();
  return row;
}

// Whitelists of valid step keys + payload top-level paths per persona,
// mirroring the wizard's STEPS arrays in
// artifacts/vndrly/src/pages/onboarding-{partner,vendor}.tsx and the
// field-employee onboarding flow. Used to block the model from writing
// arbitrary keys to the saved payload or advancing currentStep to an
// unknown step name (which would soft-brick the wizard for the user).
// Verified against the actual STEPS arrays in the wizard pages:
//   - artifacts/vndrly/src/pages/onboarding-partner.tsx
//   - artifacts/vndrly/src/pages/onboarding-vendor.tsx
//   - artifacts/vndrly/src/pages/onboarding-field.tsx
// Drift here will silently soft-brick the wizard, so update both
// places together if the persona flows change.
// STEP_KEYS / REQUIRED_STEPS / STEP_REQUIRED_FIELDS / PAYLOAD_TOP_KEYS
// + getPayloadPath / isPayloadFieldFilled live in
// `../assistant/onboarding-validation` so the regression test catalog
// can drive the same validators the route runs (no duplicated copies
// to drift). Re-aliased here to keep the existing call sites readable.
const STEP_KEYS = STEP_KEYS_DATA;
// Payload top-level keys come from the persona's payload interface in
// the wizard page (e.g. PartnerPayload, VendorPayload). Keep this in
// sync with those interfaces so the assistant can't write keys the
// wizard would just ignore.
// Steps that the wizard's canonical /complete endpoint validates and
// will reject the org for if missing. The assistant must NOT let the
// user skip these via complete_onboarding_step({skipped:true}); the
// only legitimate way past them is to complete them. This list MUST
// stay in sync with `validatePartnerPayload` / `validateVendorPayload`
// in routes/onboarding.ts — the wizard's `/complete` endpoint will
// reject the org if any of these step's fields are missing, so the
// assistant must not advertise those steps as skippable.
//   Partner.required = company-basics, first-site, tax-billing
//   Vendor.required  = company-basics, tax-ids, work-types, compliance,
//                      rates, first-employee
//   Field.required   = personal-info, photo-certs, set-password
// (everything else — partner/vendor `branding`, partner `preferences`/
// `invite-team` — is optional and can be skipped during the wizard.)
const REQUIRED_STEPS = REQUIRED_STEPS_DATA;
const STEP_REQUIRED_FIELDS = STEP_REQUIRED_FIELDS_DATA;
const PAYLOAD_TOP_KEYS = PAYLOAD_TOP_KEYS_DATA;
const getPayloadPath = getPayloadPathShared;
const isPayloadFieldFilled = isPayloadFieldFilledShared;

// Walk a dot-path and assign a value, mutating the object in place.
// Refuses to traverse into prototype-y keys to be safe with arbitrary
// model output. We never write `value` to a parent key so an array path
// like 'foo.bar' on `{foo: 7}` becomes `{foo: {bar: value}}`.
function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return;
  let cur: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (k === "__proto__" || k === "constructor" || k === "prototype") return;
    const next = cur[k];
    if (next && typeof next === "object" && !Array.isArray(next)) {
      cur = next as Record<string, unknown>;
    } else {
      const fresh: Record<string, unknown> = {};
      cur[k] = fresh;
      cur = fresh;
    }
  }
  const last = parts[parts.length - 1];
  if (last === "__proto__" || last === "constructor" || last === "prototype") return;
  cur[last] = value;
}

// ─────────────────────────────────────────────────────────────────
// Tool execution. Returns a string the model will see as the tool
// result. When a tool is forbidden for this role we say so explicitly
// so the model can apologise rather than retry blindly.
// ─────────────────────────────────────────────────────────────────
// Tools allowed when the assistant is invoked via the unauthenticated
// field-employee invite-token endpoint (no session cookie). Anything
// outside this list is refused server-side as defense-in-depth even if
// the model somehow tries to call it.
const FIELD_TOKEN_ALLOWED_TOOLS = new Set([
  "lookup_user_progress",
  "set_onboarding_field",
  "complete_onboarding_step",
  "deep_link_to",
]);

async function runTool(
  name: string,
  input: unknown,
  session: SessionPayload,
  cookieHeader: string,
  isTokenMode: boolean = false,
): Promise<string> {
  if (isTokenMode && !FIELD_TOKEN_ALLOWED_TOOLS.has(name)) {
    return JSON.stringify({
      error: `Tool '${name}' is not available in field-employee invite mode. Stick to onboarding tools and deep links.`,
    });
  }
  if (isTokenMode && isWriteTool(name)) {
    return JSON.stringify({
      error: `Tool '${name}' is not available in field-employee invite mode.`,
    });
  }
  if (isWriteTool(name)) {
    return runWriteTool(name, input, session);
  }
  try {
    switch (name) {
      case "lookup_user_progress": {
        const scope = scopeFromSession(session);
        if (!scope) return JSON.stringify({ error: "No org scope on this session." });
        const where = scope.orgType === "partner"
          ? eq(onboardingProgressTable.partnerId, scope.partnerId!)
          : scope.orgType === "vendor"
          ? eq(onboardingProgressTable.vendorId, scope.vendorId!)
          : eq(onboardingProgressTable.vendorPeopleId, scope.vendorPeopleId!);
        const [row] = await db.select().from(onboardingProgressTable).where(where).limit(1);
        if (!row) return JSON.stringify({ progress: null });
        return JSON.stringify({
          progress: {
            orgType: row.orgType,
            currentStep: row.currentStep,
            completedSteps: row.completedSteps,
            skippedSteps: row.skippedSteps,
            payload: row.payload,
            completedAt: row.completedAt,
          },
        });
      }

      case "start_onboarding": {
        const scope = scopeFromSession(session);
        if (!scope) return JSON.stringify({ error: "No org scope on this session." });
        if (session.membershipRole !== "admin" && session.role !== "field_employee" && session.role !== "admin") {
          return JSON.stringify({
            error: "Only org admins can run onboarding. Please ask a teammate with admin permissions.",
          });
        }
        const row = await ensureProgress(scope);
        return JSON.stringify({
          progress: {
            orgType: row.orgType,
            currentStep: row.currentStep,
            completedSteps: row.completedSteps,
            skippedSteps: row.skippedSteps,
          },
        });
      }

      case "set_onboarding_field": {
        const scope = scopeFromSession(session);
        if (!scope) return JSON.stringify({ error: "No org scope on this session." });
        // Same permission gate as the /onboarding/:orgType/:orgId/progress
        // PUT route (org admins or platform admins).
        const isPlatformAdmin = session.role === "admin";
        const isOrgAdmin = session.membershipRole === "admin";
        const isFieldSelf = scope.orgType === "field_employee";
        if (!isPlatformAdmin && !isOrgAdmin && !isFieldSelf) {
          return JSON.stringify({ error: "You don't have permission to write onboarding fields." });
        }
        const args = (input ?? {}) as { path?: string; value?: unknown };
        const path = typeof args.path === "string" ? args.path : "";
        if (!path) return JSON.stringify({ error: "Missing 'path'." });
        // Single source of truth for top-level key allow-listing —
        // the regression suite calls this exact function so any drift
        // is caught in CI.
        const fieldCheck = validateFieldPath(scope.orgType, path);
        if (!fieldCheck.ok) {
          return JSON.stringify({ error: fieldCheck.error });
        }
        const existing = await ensureProgress(scope);
        const payload = { ...((existing.payload ?? {}) as Record<string, unknown>) };
        setByPath(payload, path, args.value);
        await db
          .update(onboardingProgressTable)
          .set({ payload })
          .where(eq(onboardingProgressTable.id, existing.id));
        return JSON.stringify({ ok: true, path, value: args.value });
      }

      case "complete_onboarding_step": {
        const scope = scopeFromSession(session);
        if (!scope) return JSON.stringify({ error: "No org scope on this session." });
        const isPlatformAdmin = session.role === "admin";
        const isOrgAdmin = session.membershipRole === "admin";
        const isFieldSelf = scope.orgType === "field_employee";
        if (!isPlatformAdmin && !isOrgAdmin && !isFieldSelf) {
          return JSON.stringify({ error: "You don't have permission to advance onboarding." });
        }
        const args = (input ?? {}) as { step?: string; nextStep?: string; skipped?: boolean };
        const existing = await ensureProgress(scope);
        // All deterministic gating (step names, sequential progress,
        // required-step skip block, required-field presence) lives in
        // validateStepCompletion so the regression catalog can drive
        // the same validator the route runs. The route is left with
        // the auth check above and the DB write below.
        const validation = validateStepCompletion({
          persona: scope.orgType,
          step: args.step,
          nextStep: args.nextStep,
          skipped: args.skipped,
          existing: {
            currentStep: existing.currentStep,
            payload: (existing.payload ?? {}) as Record<string, unknown>,
          },
        });
        if (!validation.ok) {
          return JSON.stringify({ error: validation.error });
        }
        // validateStepCompletion already required args.step to be a
        // known step name; the cast narrows it for the Set ops below.
        const stepName = args.step as string;
        const completed = new Set(existing.completedSteps);
        const skipped = new Set(existing.skippedSteps);
        if (args.skipped) {
          skipped.add(stepName);
          completed.delete(stepName);
        } else {
          completed.add(stepName);
          skipped.delete(stepName);
        }
        await db
          .update(onboardingProgressTable)
          .set({
            currentStep: args.nextStep,
            completedSteps: Array.from(completed),
            skippedSteps: Array.from(skipped),
          })
          .where(eq(onboardingProgressTable.id, existing.id));
        return JSON.stringify({ ok: true, currentStep: args.nextStep });
      }

      case "finalize_onboarding": {
        // Platform admins don't have an org scope and shouldn't be
        // completing other orgs' onboarding from the chat surface —
        // they have the admin panel for that. Refuse early with a
        // clear message so the model can redirect the user.
        if (session.role === "admin") {
          return JSON.stringify({
            error: "Platform admins finalize an org's onboarding from the admin panel, not from chat. Open the org's onboarding page to complete it.",
          });
        }
        const scope = scopeFromSession(session);
        if (!scope) return JSON.stringify({ error: "No org scope on this session." });
        if (scope.orgType === "field_employee") {
          return JSON.stringify({
            error: "Field-employee onboarding is finalized via the password-set step on the invite link, not from chat.",
          });
        }
        // Org-admin gate: matches authorizeOrgAccess in routes/onboarding.ts.
        if (session.membershipRole !== "admin") {
          return JSON.stringify({ error: "Only org admins can finalize onboarding." });
        }
        // Defer to the canonical /onboarding/:orgType/:orgId/complete
        // endpoint so all required-field validation and canonical
        // table writes (partners/siteLocations or vendors/...) happen
        // through the same code path the wizard uses. Forwarding the
        // user's session cookie keeps authz consistent with that route.
        const orgId = scope.orgType === "partner" ? scope.partnerId! : scope.vendorId!;
        const port = process.env.PORT ?? "8080";
        const url = `http://127.0.0.1:${port}/api/onboarding/${scope.orgType}/${orgId}/complete`;
        try {
          const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", cookie: cookieHeader },
            body: "{}",
          });
          const text = await r.text();
          if (!r.ok) {
            return JSON.stringify({ ok: false, status: r.status, error: text });
          }
          return JSON.stringify({ ok: true, response: text });
        } catch (err) {
          logger.error({ err, url }, "finalize_onboarding fetch failed");
          return JSON.stringify({
            ok: false,
            error: "Couldn't reach the onboarding completion endpoint. Please try again from the wizard.",
          });
        }
      }

      case "lookup_open_invoices": {
        // Vendors see their own; partners see invoices addressed to them;
        // admins see everyone (capped). Field employees: no invoices.
        if (session.role === "field_employee") {
          return JSON.stringify({ invoices: [], note: "Field employees don't see invoices." });
        }
        const filters = [ne(invoicesTable.status, "paid")];
        if (session.role === "vendor" && session.vendorId) {
          filters.push(eq(invoicesTable.vendorId, session.vendorId));
        } else if (session.role === "partner" && session.partnerId) {
          filters.push(eq(invoicesTable.partnerId, session.partnerId));
        }
        const rows = await db
          .select({
            id: invoicesTable.id,
            invoiceNumber: invoicesTable.invoiceNumber,
            status: invoicesTable.status,
            total: invoicesTable.total,
            paidAmount: invoicesTable.paidAmount,
            dueDate: invoicesTable.dueDate,
            partnerId: invoicesTable.partnerId,
            vendorId: invoicesTable.vendorId,
          })
          .from(invoicesTable)
          .where(and(...filters))
          .orderBy(desc(invoicesTable.dueDate))
          .limit(10);
        return JSON.stringify({ invoices: rows });
      }

      case "lookup_open_tickets": {
        const filters = [ne(ticketsTable.status, "closed")];
        if (session.role === "vendor" && session.vendorId) {
          filters.push(eq(ticketsTable.vendorId, session.vendorId));
        } else if (session.role === "partner" && session.partnerId) {
          // Partner scope: tickets at sites belonging to this partner.
          // Done via subquery on sites for now to keep this self-contained.
          filters.push(
            sql`${ticketsTable.siteLocationId} IN (SELECT id FROM site_locations WHERE partner_id = ${session.partnerId})`,
          );
        } else if (session.role === "field_employee" && session.vendorPeopleId) {
          // Field portal currently joins via crew, but for a quick
          // lookup the assigned fieldEmployeeId is a usable proxy.
          filters.push(
            sql`${ticketsTable.fieldEmployeeId} IN (SELECT id FROM field_employees WHERE vendor_people_id = ${session.vendorPeopleId})`,
          );
        }
        const rows = await db
          .select({
            id: ticketsTable.id,
            status: ticketsTable.status,
            siteLocationId: ticketsTable.siteLocationId,
            vendorId: ticketsTable.vendorId,
            workTypeId: ticketsTable.workTypeId,
            createdAt: ticketsTable.createdAt,
          })
          .from(ticketsTable)
          .where(and(...filters))
          .orderBy(desc(ticketsTable.createdAt))
          .limit(10);
        return JSON.stringify({ tickets: rows });
      }

      case "deep_link_to": {
        const args = (input ?? {}) as {
          screen?: string;
          id?: number;
          token?: string;
          step?: string;
          reportCard?: string;
          reportPreset?: string;
          highlightState?: string;
        };
        if (!args.screen) return JSON.stringify({ error: "Missing 'screen'." });
        // Role-aware gate (P0 fix from assistant review): the assistant
        // must never hand out a link to a screen the caller can't load.
        // Mirrors the role-gated routing in App.tsx — admins see
        // everything; partners/vendors get their own org views; field
        // employees get the field portal + ticket detail only.
        const role: "admin" | "partner" | "vendor" | "field_employee" | "any" =
          isTokenMode ? "field_employee" : (normalizeRole(session.role as string));
        const gate = gateDeepLinkScreen(role, args.screen);
        if (!gate.ok) {
          return JSON.stringify({ error: gate.error });
        }
        const link = buildDeepLink({
          screen: args.screen,
          id: args.id,
          token: args.token,
          step: args.step,
          reportCard: args.reportCard,
          reportPreset: args.reportPreset,
          highlightState: args.highlightState,
        });
        if (typeof link === "string") return JSON.stringify({ url: link });
        return JSON.stringify(link);
      }

      default:
        // Read-only data tools live in ../assistant/data-tools.ts so the
        // route file stays focused on conversation/onboarding plumbing.
        if (isDataTool(name)) {
          return runDataTool(name, input, session);
        }
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    logger.error({ err, name }, "assistant tool failed");
    return JSON.stringify({ error: "Tool execution failed." });
  }
}

// ─────────────────────────────────────────────────────────────────
// Streaming chat endpoint. Body: { message: string }
//
// Wire format on the response is Server-Sent Events. We emit:
//   event: token   data: { delta: string }
//   event: tool    data: { name, status: 'start'|'end' }
//   event: done    data: { messageId, content }
//   event: error   data: { message }
//
// The client stitches token deltas into the visible bubble.
// ─────────────────────────────────────────────────────────────────
async function handleConversationMessage(
  req: Request,
  res: Response,
  session: SessionPayload,
  convId: number,
  userMessage: string,
): Promise<void> {
  // Load conversation + verify ownership.
  const [conv] = await db
    .select()
    .from(assistantConversationsTable)
    .where(and(eq(assistantConversationsTable.id, convId), eq(assistantConversationsTable.userId, session.userId!)))
    .limit(1);
  if (!conv) {
    res.status(404).json({ error: "Not found", code: "common.not_found" });
    return;
  }

  // Load the user's full record to pull preferredLanguage + displayName
  // for the system prompt. This is one extra query per turn but keeps
  // the prompt accurate when the user updates their language.
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.userId!)).limit(1);

  // Persist the user message immediately so the message survives a
  // mid-stream client disconnect.
  const [savedUserMsg] = await db
    .insert(assistantMessagesTable)
    .values({ conversationId: conv.id, role: "user", content: userMessage })
    .returning();

  // Auto-title on the first turn so the conversation list is useful.
  if (conv.title === "New conversation") {
    const title = userMessage.length > 60 ? userMessage.slice(0, 57) + "…" : userMessage;
    await db.update(assistantConversationsTable).set({ title }).where(eq(assistantConversationsTable.id, conv.id));
  }

  // Load prior turns for Claude. Same stable tie-break as the
  // conversation-detail read above: seeded pre-auth chats can share
  // a `created_at`, and the model would get scrambled history without
  // an `id` secondary sort.
  const prior = await db
    .select()
    .from(assistantMessagesTable)
    .where(eq(assistantMessagesTable.conversationId, conv.id))
    .orderBy(assistantMessagesTable.createdAt, assistantMessagesTable.id);
  const tail = prior.slice(Math.max(0, prior.length - MAX_PRIOR_MESSAGES));

  // Map persisted rows back to Anthropic message blocks. We only
  // persist plain text from user/assistant turns; tool_use/tool_result
  // blocks live only inside a single request loop and aren't replayed.
  const history: Anthropic.MessageParam[] = tail
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
    .map((m: { role: string; content: string }) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // Build system prompt with role + onboarding context + matched docs.
  const role = normalizeRole(session.role as string);
  const docs = selectDocs(role, userMessage);

  let onboardingProgressRow: typeof onboardingProgressTable.$inferSelect | null = null;
  const scope = scopeFromSession(session);
  if (scope) {
    const where = scope.orgType === "partner"
      ? eq(onboardingProgressTable.partnerId, scope.partnerId!)
      : scope.orgType === "vendor"
      ? eq(onboardingProgressTable.vendorId, scope.vendorId!)
      : eq(onboardingProgressTable.vendorPeopleId, scope.vendorPeopleId!);
    const [r] = await db.select().from(onboardingProgressTable).where(where).limit(1);
    onboardingProgressRow = r ?? null;
  }
  const onboardingActive = !!(onboardingProgressRow && !onboardingProgressRow.completedAt);

  const preferredLanguage = (user?.preferredLanguage as "en" | "es" | null) ?? null;
  const pageContext = parsePageContext(req.body?.pageContext);
  const systemPrompt = buildSystemPrompt({
    user: {
      userId: session.userId!,
      role,
      displayName: user?.displayName ?? "there",
      partnerId: session.partnerId ?? null,
      vendorId: session.vendorId ?? null,
      preferredLanguage,
    },
    docs,
    onboarding: {
      active: onboardingActive,
      orgType: (onboardingProgressRow?.orgType as "partner" | "vendor" | "field_employee" | null) ?? null,
      currentStep: onboardingProgressRow?.currentStep ?? null,
      completedSteps: onboardingProgressRow?.completedSteps ?? [],
      skippedSteps: onboardingProgressRow?.skippedSteps ?? [],
    },
    pageContext,
  });

  // ── SSE setup ─────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let aborted = false;
  req.on("close", () => {
    aborted = true;
  });

  // Telemetry: stamp the moment we start the turn so we can record
  // time-to-first-token on the assistant message row. The first text
  // delta in the stream sets `firstTokenMs`; subsequent rounds don't
  // (TTFT is a one-shot metric per turn). NOTE: this is the
  // *user-perceived* latency — for turns that resolve a tool call
  // before producing any text, the timer keeps running through the
  // tool round-trip. That's intentional: it's the metric a PM cares
  // about ("how long until the user sees output?"), not raw model
  // throughput.
  const turnStart = Date.now();
  let firstTokenMs: number | null = null;

  const send = (event: string, data: unknown) => {
    if (aborted) return;
    if (event === "token" && firstTokenMs === null) {
      firstTokenMs = Date.now() - turnStart;
    }
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // The running tool-use loop. We append to `messages` as we go and
  // re-enter `messages.stream` until the model stops requesting tools
  // or we hit MAX_TOOL_ROUNDS. NOTE: `history` already includes the
  // user message we just persisted above (we reload after inserting),
  // so we do NOT re-append it here — doing so would send the user
  // message twice and skew model output.
  // Compose the final messages array via the centralised helper so
  // the language primer can never be silently dropped by a refactor.
  // The helper is unit-tested in artifacts/vndrly/tests/assistant.spec.ts.
  const messages: Anthropic.MessageParam[] = composeAssistantMessages(
    preferredLanguage,
    history,
  ) as Anthropic.MessageParam[];
  const finalAssistantBlocks: Anthropic.ContentBlock[] = [];
  const toolCallTrace: Array<{ name: string; input: unknown; output: string }> = [];
  let finalText = "";

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (aborted) break;
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        tools: TOOLS,
        messages,
      });

      // Forward text deltas to the client as they arrive.
      stream.on("text", (delta: string) => {
        if (delta) send("token", { delta });
      });

      const finalMsg = await stream.finalMessage();
      messages.push({ role: "assistant", content: finalMsg.content });

      // Collect text for persistence — Claude may emit text either
      // before or between tool_use blocks across rounds. The Anthropic
      // SDK fires `stream.on("text")` for EVERY round, so we never need
      // to manually re-emit round>0 text — doing so would duplicate
      // tokens on the client. We only need to accumulate text for DB
      // persistence here.
      for (const block of finalMsg.content) {
        if (block.type === "text" && block.text) {
          finalText += block.text;
        }
        finalAssistantBlocks.push(block);
      }

      if (finalMsg.stop_reason !== "tool_use") {
        break;
      }
      // If we're about to exit the loop because we ran out of rounds,
      // tell the client the answer was truncated rather than silently
      // returning an unfinished response.
      if (round === MAX_TOOL_ROUNDS - 1 && finalMsg.stop_reason === "tool_use") {
        send("error", {
          message:
            "The assistant tried to chain too many tool calls in one turn. Please try a more specific question.",
        });
      }

      // Run each requested tool in order. Anthropic requires tool
      // results to be returned as a single user message containing one
      // tool_result per tool_use, in the same turn.
      const toolUses = finalMsg.content.filter(
        (b: Anthropic.ContentBlock): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        send("tool", { name: tu.name, status: "start" });
        const out = await runTool(tu.name, tu.input, session, req.headers.cookie ?? "");
        send("tool", { name: tu.name, status: "end" });
        toolCallTrace.push({ name: tu.name, input: tu.input, output: out });
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: out,
        });
      }
      messages.push({ role: "user", content: results });
    }

    finalText = ensureDeepLinksInAssistantReply(finalText, toolCallTrace);

    // Persist the assistant turn (text only — tool blocks recorded
    // separately as the trace). firstTokenMs and refusal are
    // best-effort telemetry feeding the admin metrics card; failing
    // to record them must not change user-visible behaviour.
    const [savedAssistantMsg] = await db
      .insert(assistantMessagesTable)
      .values({
        conversationId: conv.id,
        role: "assistant",
        content: finalText,
        toolCalls: toolCallTrace,
        firstTokenMs: firstTokenMs,
        refusal: classifyRefusal(finalText),
      })
      .returning({ id: assistantMessagesTable.id });
    // Bump conversation updatedAt for sidebar ordering.
    await db
      .update(assistantConversationsTable)
      .set({ updatedAt: new Date() })
      .where(eq(assistantConversationsTable.id, conv.id));
    // Rolling persistence cap: prune the oldest messages beyond
    // MAX_MESSAGES_PER_CONVERSATION on the way out so a chronic chat
    // doesn't grow unbounded. Best-effort — failure must not break
    // the response.
    pruneOldMessages(conv.id).catch((err) =>
      logger.warn({ err, conversationId: conv.id }, "pruneOldMessages failed"),
    );

    send("done", { content: finalText, assistantMessageId: savedAssistantMsg.id });
    res.end();
  } catch (err) {
    logger.error({ err, conversationId: conv.id }, "assistant stream failed");
    // Best-effort persist whatever we have so the user can retry.
    if (finalText) {
      try {
        await db
          .insert(assistantMessagesTable)
          .values({ conversationId: conv.id, role: "assistant", content: finalText, toolCalls: toolCallTrace });
      } catch {}
    }
    send("error", { message: "Something went wrong while answering. Please try again." });
    res.end();
  }
}

// Standard route: append a message to a known conversation. Pre-existing
// API contract used by the slide-over panel.
router.post("/assistant/conversations/:id/messages", async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" }); return; }
  const userMessage = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!userMessage) { res.status(400).json({ error: "Missing message", code: "assistant.missing_message" }); return; }
  if (userMessage.length > 4000) { res.status(400).json({ error: "Message too long", code: "assistant.message_too_long" }); return; }
  await handleConversationMessage(req, res, session, id, userMessage);
});

// Compatibility route: `POST /assistant/chat` from the task spec.
// Accepts `{ message, conversationId? }`. If conversationId is omitted
// we lazily create a new conversation for this user. Returns the same
// SSE stream the conversation/messages endpoint emits.
router.post("/assistant/chat", async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const userMessage = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!userMessage) { res.status(400).json({ error: "Missing message", code: "assistant.missing_message" }); return; }
  if (userMessage.length > 4000) { res.status(400).json({ error: "Message too long", code: "assistant.message_too_long" }); return; }
  let convId = Number(req.body?.conversationId);
  if (!Number.isFinite(convId)) {
    const [row] = await db
      .insert(assistantConversationsTable)
      .values({ userId: session.userId!, title: "New conversation" })
      .returning();
    convId = row.id;
    res.setHeader("X-Conversation-Id", String(convId));
    // Mirror the retention policy of POST /assistant/conversations:
    // lazy creation here would otherwise bypass the cap and let a
    // pathological caller grow the table unboundedly.
    pruneOldConversations(session.userId!).catch((err) =>
      logger.warn({ err, userId: session.userId }, "pruneOldConversations failed"),
    );
  }
  await handleConversationMessage(req, res, session, convId, userMessage);
});

// ─────────────────────────────────────────────────────────────────
// Token-scoped field-employee assistant
// ─────────────────────────────────────────────────────────────────
// Field-employee onboarding (`/onboarding/field/:token`) happens BEFORE
// the invitee has set a password and signed in, so they have no
// session cookie. To make the assistant available on that page we
// expose a token-authenticated chat endpoint that:
//   • Validates the invite token against vendor_people.invite_token.
//   • Synthesizes a SessionPayload-shaped object scoped to the
//     vendorPeople row so all the existing tool gates (scopeFromSession
//     etc.) work unchanged.
//   • Restricts the available tool surface (no invoices, tickets,
//     finalize) — see FIELD_TOKEN_ALLOWED_TOOLS.
//   • Is stateless: the client sends the prior message history each
//     turn (max ~24 turns enforced server-side). We don't persist
//     because the assistant_conversations table requires a userId,
//     and field employees only have a userId AFTER they set their
//     password — which is the last step of this very wizard.
router.post("/assistant/field-onboarding/:token/chat", async (req, res) => {
  const token = String(req.params.token ?? "");
  if (!token || token.length < 16) {
    res.status(404).json({ error: "Invalid token", code: "auth.invalid_token" });
    return;
  }
  const userMessage = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!userMessage) { res.status(400).json({ error: "Missing message", code: "assistant.missing_message" }); return; }
  if (userMessage.length > 4000) { res.status(400).json({ error: "Message too long", code: "assistant.message_too_long" }); return; }

  // Resolve the token to a vendor_people row.
  const [employee] = await db
    .select()
    .from(vendorPeopleTable)
    .where(and(eq(vendorPeopleTable.inviteToken, token), isNull(vendorPeopleTable.deletedAt)))
    .limit(1);
  if (!employee) {
    res.status(404).json({ error: "Invalid or expired token", code: "auth.invalid_or_expired_token" });
    return;
  }
  const [vendor] = await db
    .select({ name: vendorsTable.name })
    .from(vendorsTable)
    .where(eq(vendorsTable.id, employee.vendorId))
    .limit(1);

  // Synthesize a session that scopeFromSession() will accept. userId
  // is intentionally absent — none of the tools the token mode allows
  // need it (lookup_user_progress / set_onboarding_field /
  // complete_onboarding_step / deep_link_to all key off vendorPeopleId).
  const session: SessionPayload = {
    role: "field_employee",
    vendorPeopleId: employee.id,
    vendorId: employee.vendorId,
    membershipRole: null,
    displayName: `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim() || "there",
  };

  // History from the client — sanitized to plain user/assistant text.
  // We cap to MAX_PRIOR_MESSAGES so a malicious client can't blow up
  // our context window. The current message is appended after the
  // history.
  const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
  const history: Anthropic.MessageParam[] = rawHistory
    .slice(-MAX_PRIOR_MESSAGES)
    .filter((m: unknown): m is { role: string; content: string } =>
      !!m && typeof m === "object" &&
      ((m as { role?: unknown }).role === "user" || (m as { role?: unknown }).role === "assistant") &&
      typeof (m as { content?: unknown }).content === "string",
    )
    .map((m: { role: string; content: string }) => ({ role: m.role as "user" | "assistant", content: m.content }));
  history.push({ role: "user", content: userMessage });

  // System prompt: same builder, but with field_employee role and the
  // current onboarding progress fetched fresh.
  const role: KnowledgeRole = "field_employee";
  const docs = selectDocs(role, userMessage);
  const [progressRow] = await db
    .select()
    .from(onboardingProgressTable)
    .where(eq(onboardingProgressTable.vendorPeopleId, employee.id))
    .limit(1);
  const onboardingActive = !!(progressRow && !progressRow.completedAt);
  const systemPrompt = buildSystemPrompt({
    user: {
      userId: 0,
      role,
      displayName: session.displayName ?? "there",
      partnerId: null,
      vendorId: employee.vendorId,
      preferredLanguage: null,
    },
    docs,
    onboarding: {
      active: onboardingActive,
      orgType: "field_employee",
      currentStep: progressRow?.currentStep ?? "personal-info",
      completedSteps: progressRow?.completedSteps ?? [],
      skippedSteps: progressRow?.skippedSteps ?? [],
    },
  });
  void vendor; // employer name is captured in displayName context already

  // Pre-auth invitees don't have a `users` row yet, so the canonical
  // `users.preferred_language` is unavailable. Instead we read the
  // language picked on the public onboarding page, which is persisted
  // to `vendor_people.preferred_language` whenever the invitee
  // touches the English/Español toggle. Falling back to `null` when
  // unset means the assistant defaults to English (no primer
  // emitted), preserving the original behaviour for English speakers.
  const tokenPreferredLanguage = tokenModePreferredLanguage(employee);

  // Restricted tool surface — only the four whitelisted in
  // FIELD_TOKEN_ALLOWED_TOOLS are advertised to the model so it
  // doesn't even attempt the others. runTool's defense-in-depth
  // refuses unknown ones too.
  const tools = TOOLS.filter((t) => FIELD_TOKEN_ALLOWED_TOOLS.has(t.name));

  // ── SSE setup ─────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let aborted = false;
  req.on("close", () => { aborted = true; });
  const send = (event: string, data: unknown) => {
    if (aborted) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const messages: Anthropic.MessageParam[] = composeAssistantMessages(
    tokenPreferredLanguage,
    history,
  ) as Anthropic.MessageParam[];
  let finalText = "";
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (aborted) break;
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        tools,
        messages,
      });
      stream.on("text", (delta: string) => {
        if (delta) send("token", { delta });
      });
      const finalMsg = await stream.finalMessage();
      messages.push({ role: "assistant", content: finalMsg.content });
      for (const block of finalMsg.content) {
        if (block.type === "text" && block.text) finalText += block.text;
      }
      if (finalMsg.stop_reason !== "tool_use") break;
      if (round === MAX_TOOL_ROUNDS - 1) {
        send("error", { message: "Too many tool calls in one turn. Please ask a more specific question." });
      }
      const toolUses = finalMsg.content.filter(
        (b: Anthropic.ContentBlock): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        send("tool", { name: tu.name, status: "start" });
        // Token-mode: pass empty cookie + isTokenMode=true so runTool
        // refuses anything outside FIELD_TOKEN_ALLOWED_TOOLS even if
        // the model invents a call beyond the advertised tools.
        const out = await runTool(tu.name, tu.input, session, "", true);
        send("tool", { name: tu.name, status: "end" });
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
      }
      messages.push({ role: "user", content: results });
    }
    send("done", { content: finalText });
    res.end();
  } catch (err) {
    logger.error({ err, vendorPeopleId: employee.id }, "field-token assistant stream failed");
    send("error", { message: "Something went wrong while answering. Please try again." });
    res.end();
  }
});

// ─────────────────────────────────────────────────────────────────
// Pre-auth signup-page assistant
// ─────────────────────────────────────────────────────────────────

/**
 * Stream a synthetic "the assistant is napping" reply via the same SSE
 * envelope a real Anthropic turn uses, then end the response. Used by
 * the signup-page handler when an abuse-control gate fires (per-IP
 * limit or daily budget exhausted) so the visitor sees a friendly
 * message in the chat bubble instead of a generic HTTP error.
 *
 * No `token` deltas are emitted — only a single `done` event with the
 * full text — because there is nothing to stream incrementally.
 */
function sendSignupAssistantNapping(
  res: Response,
  message: string,
  opts: { retryAfterSeconds?: number } = {},
): void {
  if (typeof opts.retryAfterSeconds === "number" && opts.retryAfterSeconds > 0) {
    res.setHeader("Retry-After", String(opts.retryAfterSeconds));
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(`event: done\n`);
  res.write(`data: ${JSON.stringify({ content: message })}\n\n`);
  res.end();
}

// The Ask VNDRLY launcher is hidden everywhere else pre-auth, but
// `/signup/partner` and `/signup/vendor` are the two surfaces where a
// brand-new visitor can get genuinely stuck filling out the form.
// This endpoint exposes a stripped-down assistant for those pages:
//   • No session required, no token required — fully anonymous.
//   • Persona-scoped knowledge slice (selectSignupDocs) limited to the
//     public/onboarding-prep allow-list. Operational features
//     (tickets, invoices, crew map, etc.) are not visible to this
//     assistant so it cannot imply capabilities the visitor doesn't yet
//     have access to.
//   • NO tools at all — `tools` is omitted from the Anthropic call so
//     the model physically cannot request a tool_use block. There is no
//     tool_use loop and no DB write path. Defense-in-depth: even if a
//     malicious prompt convinces the model to ask for a tool, the
//     server has no handler to invoke.
//   • Stateless — history is sent client-side per turn (capped to
//     MAX_PRIOR_MESSAGES) since the visitor has no userId to attach a
//     conversation row to.
//   • Body length capped to keep costs bounded.
//   • Per-IP fixed-window rate limit + global per-day circuit breaker
//     in `lib/signup-assistant-rate-limit` so a script can't drain our
//     Anthropic credits. Limit-exceeded turns are short-circuited
//     server-side and a friendly chat bubble is streamed back via SSE
//     instead of dispatching to Claude.
router.post("/assistant/signup/:persona/chat", async (req, res) => {
  const persona = String(req.params.persona ?? "");
  if (persona !== "partner" && persona !== "vendor") {
    res.status(404).json({ error: "Invalid signup persona", code: "assistant.invalid_persona" });
    return;
  }
  const userMessage = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!userMessage) { res.status(400).json({ error: "Missing message", code: "assistant.missing_message" }); return; }
  if (userMessage.length > 4000) { res.status(400).json({ error: "Message too long", code: "assistant.message_too_long" }); return; }

  // ── Abuse controls ────────────────────────────────────────────
  // The order matters: per-IP first so a single noisy script doesn't
  // count against the global budget for everyone else; the daily
  // budget check is a second layer in case many IPs participate or a
  // spoofed XFF header bypasses the per-IP layer. Both gates run
  // BEFORE language hint parsing / Anthropic dispatch so a flood
  // never reaches the model.
  const clientIp = getClientIp(req);
  const ipHit = await recordIpHit(clientIp);
  if (!ipHit.ok) {
    const retryMinutes = Math.max(1, Math.ceil(ipHit.retryAfterMs / 60000));
    logger.warn(
      {
        kind: "signup_assistant.rate_limit.ip",
        persona,
        clientIp,
        limit: ipHit.limit,
        windowMs: ipHit.windowMs,
        retryAfterMs: ipHit.retryAfterMs,
      },
      "signup-assistant per-IP rate limit hit",
    );
    // Feed the digest aggregator so the daily abuse email can show
    // both the volume and which IPs are actually hitting the limiter.
    recordSignupAssistantDigestHit(clientIp, {
      dispatched: false,
      ipBlocked: true,
      breakerTripped: false,
    });
    sendSignupAssistantNapping(
      res,
      `You've sent a lot of messages in a short window — let's pause for a few minutes so the assistant doesn't get overwhelmed. Please try again in about ${retryMinutes} minute${retryMinutes === 1 ? "" : "s"}.`,
      { retryAfterSeconds: Math.ceil(ipHit.retryAfterMs / 1000) },
    );
    return;
  }

  const dailyHit = await consumeDailyBudget();
  if (!dailyHit.ok) {
    logger.warn(
      {
        kind: "signup_assistant.rate_limit.daily",
        persona,
        clientIp,
        used: dailyHit.used,
        budget: dailyHit.budget,
        dayKey: dailyHit.dayKey,
      },
      "signup-assistant daily budget exhausted — circuit breaker open",
    );
    recordSignupAssistantDigestHit(clientIp, {
      dispatched: false,
      ipBlocked: false,
      breakerTripped: true,
    });
    sendSignupAssistantNapping(
      res,
      "The signup assistant is napping for the rest of the day. You can keep filling out the form on your own — everything you need is right on this page — and the assistant will be back tomorrow.",
    );
    return;
  }

  recordSignupAssistantDigestHit(clientIp, {
    dispatched: true,
    ipBlocked: false,
    breakerTripped: false,
  });

  logger.info(
    {
      kind: "signup_assistant.dispatch",
      persona,
      clientIp,
      todayUsed: dailyHit.used,
      todayBudget: dailyHit.budget,
      ipRemaining: ipHit.remaining,
    },
    "signup-assistant dispatched to Anthropic",
  );

  // Browser-derived language hint. The launcher sniffs
  // `navigator.language` (and respects an explicit EN/ES toggle in
  // the panel header) and forwards the result here. Only "en" / "es"
  // are accepted — anything else (including missing) collapses to
  // null so a malformed client payload can never break the route.
  const rawLang = req.body?.lang;
  const lang: "en" | "es" | null =
    rawLang === "es" ? "es" : rawLang === "en" ? "en" : null;

  // Sanitize client-supplied history to plain user/assistant text and
  // cap it. Same shape as the field-token endpoint above; the explicit
  // type on `m` in the .map is required because the .filter's
  // user-defined type guard isn't narrowing through `any[]` from
  // req.body in this tsconfig.
  const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
  const history: Anthropic.MessageParam[] = rawHistory
    .slice(-MAX_PRIOR_MESSAGES)
    .filter((m: unknown): m is { role: string; content: string } =>
      !!m && typeof m === "object" &&
      ((m as { role?: unknown }).role === "user" || (m as { role?: unknown }).role === "assistant") &&
      typeof (m as { content?: unknown }).content === "string",
    )
    .map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
  history.push({ role: "user", content: userMessage });

  const docs = selectSignupDocs(persona, userMessage);
  const systemPrompt = buildSignupSystemPrompt({ persona, docs, lang });
  // Same priming pattern post-auth chat uses: when the visitor's
  // browser/toggle says Spanish, prepend the synthetic user/assistant
  // primer so Claude locks Spanish from the very first reply. English
  // and null are no-ops (English is Claude's default reply language).
  const messages: Anthropic.MessageParam[] = composeAssistantMessages(lang, history);

  // ── SSE setup ─────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let aborted = false;
  req.on("close", () => { aborted = true; });
  const send = (event: string, data: unknown) => {
    if (aborted) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let finalText = "";
  try {
    // Single-round call — no `tools` arg means no tool_use block can
    // ever appear in the response, so we don't need the loop the
    // session-authenticated and token-mode handlers have. If a future
    // change ever adds tools here, remember to put back a bounded loop.
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages,
    });
    stream.on("text", (delta: string) => {
      if (delta) send("token", { delta });
    });
    const finalMsg = await stream.finalMessage();
    for (const block of finalMsg.content) {
      if (block.type === "text" && block.text) finalText += block.text;
    }
    send("done", { content: finalText });
    res.end();
  } catch (err) {
    logger.error({ err, persona }, "signup-mode assistant stream failed");
    send("error", { message: "Something went wrong while answering. Please try again." });
    res.end();
  }
});

// Voice input: mobile records audio → Whisper STT → text fed into normal AskV chat.
router.post("/assistant/transcribe", async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    res.status(503).json({
      error: "Voice input is not configured",
      code: "assistant.transcribe_unavailable",
    });
    return;
  }

  const audioBase64 = typeof req.body?.audioBase64 === "string" ? req.body.audioBase64.trim() : "";
  if (!audioBase64) {
    res.status(400).json({ error: "Missing audio", code: "assistant.missing_audio" });
    return;
  }

  let audio: Buffer;
  try {
    audio = Buffer.from(audioBase64, "base64");
  } catch {
    res.status(400).json({ error: "Invalid audio", code: "assistant.invalid_audio" });
    return;
  }

  if (audio.length > 4 * 1024 * 1024) {
    res.status(400).json({ error: "Audio too large", code: "assistant.audio_too_large" });
    return;
  }

  try {
    const text = await transcribeAudioBuffer(audio, "askv.m4a", apiKey);
    if (!text) {
      res.status(422).json({ error: "No speech detected", code: "assistant.no_speech" });
      return;
    }
    res.json({ text });
  } catch (err) {
    logger.error({ err, userId: session.userId }, "assistant transcribe failed");
    res.status(502).json({
      error: "Transcription failed",
      code: "assistant.transcribe_failed",
    });
  }
});

// Voice output: mobile sends AskV reply text -> OpenAI TTS -> playable MP3.
router.post("/assistant/tts", async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    res.status(503).json({
      error: "Voice output is not configured",
      code: "assistant.tts_unavailable",
    });
    return;
  }

  const rawText = typeof req.body?.text === "string" ? req.body.text : "";
  const text = markdownToSpeechText(rawText);
  if (!text) {
    res.status(400).json({ error: "Missing text", code: "assistant.missing_text" });
    return;
  }

  const voice = normalizeBuiltInTtsVoice(req.body?.voice ?? process.env.ASKV_TTS_VOICE);
  const model = process.env.ASKV_TTS_MODEL?.trim() || "gpt-4o-mini-tts";
  const instructions =
    process.env.ASKV_TTS_INSTRUCTIONS?.trim() ||
    "Speak as AskV, a calm field operations assistant. Sound concise, steady, clear, and useful. Do not add words that are not in the text.";

  try {
    const out = await synthesizeSpeechBuffer({
      text,
      apiKey,
      voice,
      model,
      instructions,
    });
    res.json({
      audioBase64: out.audio.toString("base64"),
      mimeType: out.mimeType,
      model: out.model,
      voice: out.voice,
    });
  } catch (err) {
    logger.error({ err, userId: session.userId }, "assistant tts failed");
    res.status(502).json({
      error: "Text to speech failed",
      code: "assistant.tts_failed",
    });
  }
});

export default router;
