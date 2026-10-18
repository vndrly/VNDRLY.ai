import { pool } from "@workspace/db";
import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type { PoolClient } from "pg";
import type { SessionPayload } from "../lib/session";
import {
  calculateGateBillingPeriod,
  GateDailyBillingConfigSchema,
  GateDailyBillingConfigureSchema,
  GateDailyBillingCloseSchema,
  GateDailyBillingPostsSchema,
  GateDailyBillingSetupSchema,
  GateDailyBillingResultSchema,
  GateDailyBillingReceiptSchema,
  type GateDailyBillingResult,
} from "@workspace/api-zod";
import { changeOverTransaction } from "./gate-change-over";
import { withVerifiedWorkdayClient } from "./workday";

export class GateBillingError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}
function fail(code: string, status = 409): never {
  throw new GateBillingError(`gate_billing.${code}`, status);
}
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ConfigureSchema = GateDailyBillingConfigureSchema,
  CloseSchema = GateDailyBillingCloseSchema;
const ConfigSchema = GateDailyBillingConfigSchema.extend({
  directionActor: z
    .object({
      userId: z.number().int().positive(),
      role: z.literal("vendor"),
      vendorId: z.number().int().positive(),
      activeMembershipId: z.number().int().positive(),
      membershipRole: z.string(),
      sv: z.number().int().positive(),
    })
    .nullable(),
}).strict();
type Config = z.infer<typeof ConfigSchema>;
type BillingResult = GateDailyBillingResult;
function publicConfig(value: Config) {
  const { directionActor: _, ...safe } = value;
  return GateDailyBillingConfigSchema.parse(safe);
}
type Context = {
  station: {
    id: string;
    name: string;
    site_id: number;
    site_name: string;
    partner_id: number;
    partner_name: string;
    afe: string | null;
  };
  vendorId: number;
  userId: number;
};
async function readRecord(
  c: PoolClient,
  vendorId: number,
  type: string,
  id: string,
) {
  return (
    (
      await c.query(
        "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND partner_id IS NULL AND target_type=$2 AND target_id=$3 ORDER BY id DESC LIMIT 1",
        [vendorId, type, id],
      )
    ).rows[0]?.tool_output ?? null
  );
}
async function append(
  c: PoolClient,
  session: SessionPayload,
  type: string,
  id: string,
  value: unknown,
) {
  await c.query(
    "INSERT INTO assistant_action_audit(user_id,vendor_id,actor_role,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,$3,'gate-billing','typed','canonical','gate_daily_billing','office-billing',$4,$5,$6::jsonb,'completed')",
    [
      session.userId,
      session.vendorId,
      session.role,
      type,
      id,
      JSON.stringify(value),
    ],
  );
}
async function requireOffice(
  c: PoolClient,
  session: SessionPayload,
): Promise<void> {
  if (
    session.realm === "demo" ||
    session.publicDemo ||
    session.role !== "vendor" ||
    !session.vendorId
  )
    fail("office_required", 403);
  await withVerifiedWorkdayClient(session, c, async () => {});
  const office = (
    await c.query(
      "SELECT m.id FROM user_org_memberships m LEFT JOIN vendor_people p ON p.id=m.vendor_people_id AND p.vendor_id=m.vendor_id AND p.is_active=true AND p.deleted_at IS NULL WHERE m.id=$1 AND m.user_id=$2 AND m.vendor_id=$3 AND m.org_type='vendor' AND (m.role='admin' OR p.vendor_role='office')",
      [session.activeMembershipId, session.userId, session.vendorId],
    )
  ).rows[0];
  if (!office) fail("office_required", 403);
}
async function authorize(
  c: PoolClient,
  session: SessionPayload,
  stationId: string,
): Promise<Context> {
  await requireOffice(c, session);
  const station = (
    await c.query(
      "SELECT g.id,g.name,g.site_id,s.name AS site_name,s.partner_id,p.name AS partner_name,s.afe FROM gate_stations g JOIN site_locations s ON s.id=g.site_id JOIN partners p ON p.id=s.partner_id WHERE g.id=$1 AND EXISTS(SELECT 1 FROM site_work_assignments a WHERE a.site_location_id=s.id AND a.vendor_id=$2 AND a.is_gate_contractor=true) FOR SHARE OF g,s",
      [stationId, session.vendorId],
    )
  ).rows[0];
  if (!station) fail("post_forbidden", 403);
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `gate-billing:${session.vendorId}:${stationId}`,
  ]);
  return { station, vendorId: session.vendorId!, userId: session.userId! };
}
async function terms(c: PoolClient, context: Context, workTypeId: number) {
  // A retained assignment/rate is not authority after the partner explicitly
  // revokes the company relationship. Keep the historical period for review.
  const relationship = (
    await c.query(
      "SELECT status FROM partner_vendor_relationships WHERE vendor_id=$1 AND partner_id=$2 FOR SHARE",
      [context.vendorId, context.station.partner_id],
    )
  ).rows[0];
  if (relationship?.status === "revoked") fail("commercial_authority_revoked");

  const row = (
    await c.query(
      "SELECT p.id,p.approved_at,p.approved_unit_price,p.precise_unit_price,COALESCE(NULLIF(btrim(a.afe),''),NULLIF(btrim(s.afe),''),'') AS afe FROM partner_vendor_work_type_approvals p JOIN vendor_work_types v ON v.vendor_id=p.vendor_id AND v.work_type_id=p.work_type_id JOIN site_work_assignments a ON a.vendor_id=p.vendor_id AND a.work_type_id=p.work_type_id AND a.site_location_id=$3 AND a.is_gate_contractor=true JOIN site_locations s ON s.id=a.site_location_id WHERE p.vendor_id=$1 AND p.partner_id=$2 AND p.work_type_id=$4 AND p.approved_unit='per_day' AND p.approved_currency='USD' FOR SHARE OF p,v,a",
      [
        context.vendorId,
        context.station.partner_id,
        context.station.site_id,
        workTypeId,
      ],
    )
  ).rows[0];
  if (!row || row.approved_unit_price === null)
    fail("approved_daily_terms_required");
  // These existing contract prices are cents. Do not silently truncate a more
  // precise approved commercial rate into a different Gate day agreement.
  const match = /^(\d+)\.(\d{2})$/.exec(String(row.approved_unit_price));
  if (!match) fail("approved_daily_terms_required");
  const rate = Number(BigInt(match[1]) * 100n + BigInt(match[2]));
  if (
    !Number.isSafeInteger(rate) ||
    rate > 100000000 ||
    (row.precise_unit_price !== null &&
      Number(row.precise_unit_price) !== Number(row.approved_unit_price))
  )
    fail("precise_agreement_review_required");
  return {
    dailyRateCents: rate,
    approvalId: row.id as number,
    approvalAt: new Date(row.approved_at).toISOString(),
    afe: row.afe as string,
  };
}
async function config(c: PoolClient, context: Context) {
  const value = await readRecord(
    c,
    context.vendorId,
    "gate-billing-config",
    context.station.id,
  );
  if (!value) return null;
  const saved = ConfigSchema.parse(value);
  if (
    saved.vendorId !== context.vendorId ||
    saved.stationId !== context.station.id ||
    saved.siteId !== context.station.site_id ||
    saved.partnerId !== context.station.partner_id
  )
    fail("context_changed");
  return saved;
}
async function newTicket(
  c: PoolClient,
  session: SessionPayload,
  context: Context,
  workTypeId: number,
  startDay: string,
) {
  const id = (
    await c.query(
      "INSERT INTO tickets(site_location_id,vendor_id,work_type_id,status,lifecycle_state,intake_channel,description,created_by_id) VALUES($1,$2,$3,'initiated','pending_arrival','office_on_behalf_of_field_employee',$4,$5) RETURNING id",
      [
        context.station.site_id,
        context.vendorId,
        workTypeId,
        `Gate daily billing - ${context.station.name} - period from ${startDay} Central`,
        session.userId,
      ],
    )
  ).rows[0].id as number;
  await c.query(
    "INSERT INTO ticket_status_history(ticket_id,from_status,to_status,actor_user_id,actor_role,reason) VALUES($1,NULL,'initiated',$2,'vendor','Gate post daily billing period opened')",
    [id, session.userId],
  );
  return id;
}
async function preview(
  c: PoolClient,
  context: Context,
  current: Config,
  now: Date,
) {
  const rows = (
    await c.query(
      "SELECT id,started_at,ended_at FROM gate_duty_sessions WHERE station_id=$1 AND post_coverage->>'vendorId'=$2 AND started_at<$3 AND (ended_at IS NULL OR ended_at>=($4::date-interval '1 day')) ORDER BY id",
      [
        context.station.id,
        String(context.vendorId),
        now,
        current.periodStartDay,
      ],
    )
  ).rows;
  const coverage = rows.map((row) => ({
    id: row.id,
    startedAt: new Date(row.started_at).toISOString(),
    endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
  }));
  const period = calculateGateBillingPeriod({
    startDay: current.periodStartDay,
    now: now.toISOString(),
    dailyRateCents: current.dailyRateCents,
    partialDayRule: current.partialDayRule,
    coverage: coverage.map(({ id: _, ...value }) => value),
  });
  return {
    config: publicConfig(current),
    period,
    fingerprint: digest({
      current,
      cutoff: period.cutoffExclusive,
      coverage,
      days: period.days,
    }),
    invoiceStatus: "awaiting_partner_approval" as const,
  };
}
/** One serialized office path for manual, assistant and explicitly scheduled
 * post-day billing. Existing canonical tickets, lines and invoices remain the
 * financial records; audit metadata stores only agreement/period references. */
export function createGateDailyBillingService(
  options: { now?: () => Date } = {},
) {
  const now = options.now ?? (() => new Date());
  const run = <T>(
    session: SessionPayload,
    stationId: string,
    work: (c: PoolClient, context: Context) => Promise<T>,
  ) =>
    changeOverTransaction(async (c) => {
      const context = await authorize(c, session, z.uuid().parse(stationId));
      return work(c, context);
    });
  const retry = async (
    c: PoolClient,
    context: Context,
    operationId: string,
    fingerprint: string,
  ) => {
    const prior = await readRecord(
      c,
      context.vendorId,
      "gate-billing-operation",
      operationId,
    );
    if (prior && prior.fingerprint !== fingerprint) fail("operation_conflict");
    return prior;
  };
  const basic = {
    posts: (session: SessionPayload, raw: unknown) =>
      changeOverTransaction(async (c) => {
        await requireOffice(c, session);
        const query = z
          .object({ after: z.uuid().optional() })
          .strict()
          .parse(raw);
        const rows = (
          await c.query(
            "SELECT g.id,g.name,g.site_id,s.name AS site_name,s.partner_id,p.name AS partner_name FROM gate_stations g JOIN site_locations s ON s.id=g.site_id JOIN partners p ON p.id=s.partner_id WHERE ($2::uuid IS NULL OR g.id>$2) AND EXISTS(SELECT 1 FROM site_work_assignments a WHERE a.site_location_id=g.site_id AND a.vendor_id=$1 AND a.is_gate_contractor=true) ORDER BY g.id LIMIT 101",
            [session.vendorId, query.after ?? null],
          )
        ).rows;
        return GateDailyBillingPostsSchema.parse({
          items: rows.slice(0, 100).map((row) => ({
            id: row.id,
            name: row.name,
            siteId: row.site_id,
            siteName: row.site_name,
            partnerId: row.partner_id,
            partnerName: row.partner_name,
          })),
          nextCursor: rows.length > 100 ? rows[99].id : null,
        });
      }),
    setup: (session: SessionPayload, stationId: string) =>
      run(session, stationId, async (c, context) => {
        const current = await config(c, context),
          ids = (
            await c.query(
              "SELECT w.id,w.name FROM work_types w JOIN site_work_assignments a ON a.work_type_id=w.id WHERE a.vendor_id=$1 AND a.site_location_id=$2 AND a.is_gate_contractor=true ORDER BY w.name",
              [context.vendorId, context.station.site_id],
            )
          ).rows,
          services = [];
        for (const item of ids) {
          try {
            const price = await terms(c, context, item.id);
            services.push({
              id: item.id,
              name: item.name,
              dailyRateCents: price.dailyRateCents,
            });
          } catch (error) {
            if (!(error instanceof GateBillingError)) throw error;
          }
        }
        const notice = await readRecord(
          c,
          context.vendorId,
          "gate-billing-schedule-exception",
          stationId,
        );
        return GateDailyBillingSetupSchema.parse({
          automationNotice:
            notice && notice.configVersion === current?.version
              ? { code: notice.code, recordedAt: notice.recordedAt }
              : null,
          post: {
            id: stationId,
            name: context.station.name,
            siteId: context.station.site_id,
            siteName: context.station.site_name,
            partnerId: context.station.partner_id,
            partnerName: context.station.partner_name,
          },
          config: current ? publicConfig(current) : null,
          services,
        });
      }),
    receipt: (session: SessionPayload, stationId: string, rawId: string) =>
      run(session, stationId, async (c, context) => {
        const operationId = z.uuid().parse(rawId),
          record = await readRecord(
            c,
            context.vendorId,
            "gate-billing-operation",
            operationId,
          );
        if (!record || record.stationId !== stationId)
          return GateDailyBillingReceiptSchema.parse({
            state: "not_found",
            operationId,
            stationId,
            result: null,
          });
        const result =
          record.kind === "configure"
            ? publicConfig(ConfigSchema.parse(record.result))
            : GateDailyBillingResultSchema.parse(record.result);
        return GateDailyBillingReceiptSchema.parse({
          state: "completed",
          operationId,
          stationId,
          recordedAt: record.recordedAt,
          kind: record.kind,
          result,
        });
      }),
    configure: (session: SessionPayload, stationId: string, raw: unknown) =>
      run(session, stationId, async (c, context) => {
        const input = ConfigureSchema.parse(raw),
          fingerprint = digest({ stationId, input, actor: context.userId }),
          prior = await retry(c, context, input.operationId, fingerprint);
        if (prior) return publicConfig(ConfigSchema.parse(prior.result));
        const previous = await config(c, context);
        if ((previous?.version ?? 0) !== input.expectedVersion)
          fail("version_conflict");
        if (
          previous?.openTicketId &&
          (previous.workTypeId !== input.workTypeId ||
            previous.periodStartDay !== input.startDay ||
            previous.partialDayRule !== input.partialDayRule ||
            previous.agreementReference !== input.agreementReference)
        )
          fail("close_period_before_terms_change");
        if (
          previous?.lastBilledThroughDay &&
          input.startDay <= previous.lastBilledThroughDay
        )
          fail("period_already_billed");
        calculateGateBillingPeriod({
          startDay: input.startDay,
          now: now().toISOString(),
          dailyRateCents: 0,
          coverage: [],
        });
        const approved = previous?.openTicketId
          ? {
              dailyRateCents: previous.dailyRateCents,
              approvalId: previous.approvalId,
              approvalAt: previous.approvalAt,
              afe: previous.afe,
            }
          : await terms(c, context, input.workTypeId);
        const saved = ConfigSchema.parse({
          version: (previous?.version ?? 0) + 1,
          stationId,
          vendorId: context.vendorId,
          partnerId: context.station.partner_id,
          siteId: context.station.site_id,
          workTypeId: input.workTypeId,
          periodStartDay: input.startDay,
          openTicketId:
            previous?.openTicketId ??
            (await newTicket(
              c,
              session,
              context,
              input.workTypeId,
              input.startDay,
            )),
          agreementReference: input.agreementReference,
          partialDayRule: input.partialDayRule,
          ...approved,
          lastBilledThroughDay: previous?.lastBilledThroughDay ?? null,
          autoInvoiceEveryDays: input.autoInvoiceEveryDays,
          directionActor: input.autoInvoiceEveryDays
            ? {
                userId: session.userId,
                role: "vendor",
                vendorId: session.vendorId,
                activeMembershipId: session.activeMembershipId,
                membershipRole: session.membershipRole,
                sv: session.sv,
              }
            : null,
        });
        await append(c, session, "gate-billing-config", stationId, saved);
        await append(c, session, "gate-billing-operation", input.operationId, {
          fingerprint,
          stationId,
          kind: "configure",
          recordedAt: now().toISOString(),
          result: saved,
        });
        return publicConfig(saved);
      }),
    preview: (session: SessionPayload, stationId: string) =>
      run(session, stationId, async (c, context) => {
        const current = await config(c, context);
        if (!current) fail("setup_required", 404);
        return preview(c, context, current, now());
      }),
    invoiceNow: (
      session: SessionPayload,
      stationId: string,
      raw: unknown,
      executionSource: "manual" | "scheduled" = "manual",
    ) =>
      run(session, stationId, async (c, context) => {
        const input = CloseSchema.parse(raw),
          fingerprint = digest({ stationId, input, actor: context.userId }),
          prior = await retry(c, context, input.operationId, fingerprint);
        if (prior) return GateDailyBillingResultSchema.parse(prior.result);
        const current = await config(c, context);
        if (!current) fail("setup_required", 404);
        if (current.version !== input.expectedVersion) fail("version_conflict");
        if (
          executionSource === "scheduled" &&
          (!current.autoInvoiceEveryDays ||
            !current.directionActor ||
            input.minimumCompletedDays !== current.autoInvoiceEveryDays ||
            current.directionActor.userId !== session.userId ||
            current.directionActor.vendorId !== session.vendorId ||
            current.directionActor.activeMembershipId !==
              session.activeMembershipId ||
            current.directionActor.membershipRole !== session.membershipRole)
        )
          fail("schedule_direction_changed");
        // Current commercial access and the partner approval must still exist;
        // use the saved period's approved rate, not today's mutable catalog price.
        const continuationTerms = await terms(c, context, current.workTypeId);
        const quote = await preview(c, context, current, now());
        if (quote.fingerprint !== input.previewFingerprint)
          fail("preview_changed");
        if (
          input.minimumCompletedDays !== null &&
          quote.period.days.length < input.minimumCompletedDays
        ) {
          const result: BillingResult = {
            status: "not_due",
            ticketId: current.openTicketId,
            nextTicketId: null,
            billedThroughDay: null,
            invoiceStatus: "not_created",
          };
          await append(
            c,
            session,
            "gate-billing-operation",
            input.operationId,
            {
              fingerprint,
              stationId,
              kind: "invoice_now",
              recordedAt: now().toISOString(),
              result,
            },
          );
          return result;
        }
        if (
          !current.openTicketId ||
          !quote.period.days.length ||
          !quote.period.billableDays
        )
          fail("no_completed_billable_days");
        if (
          quote.period.days.some((day) => day.hasCoverageGap) &&
          !input.acknowledgeCoverageGaps
        )
          fail("coverage_review_required");
        const ticket = (
          await c.query(
            "SELECT status FROM tickets WHERE id=$1 AND vendor_id=$2 AND site_location_id=$3 AND work_type_id=$4 FOR UPDATE",
            [
              current.openTicketId,
              context.vendorId,
              context.station.site_id,
              current.workTypeId,
            ],
          )
        ).rows[0];
        if (
          !ticket ||
          ticket.status !== "initiated" ||
          Number(
            (
              await c.query(
                "SELECT count(*)::int AS n FROM ticket_line_items WHERE ticket_id=$1",
                [current.openTicketId],
              )
            ).rows[0].n,
          )
        )
          fail("ticket_review_required");
        for (const day of quote.period.days)
          if (day.staffedMilliseconds > 0)
            await c.query(
              "INSERT INTO ticket_line_items(ticket_id,type,description,quantity,unit_price) VALUES($1,'labor',$2,1,$3)",
              [
                current.openTicketId,
                `${context.station.name} - ${day.day} Central - day rate agreement ${current.agreementReference}${day.hasCoverageGap ? " (partial/recorded coverage reviewed)" : ""}`,
                `${Math.floor(day.chargeCents / 100)}.${String(day.chargeCents % 100).padStart(2, "0")}`,
              ],
            );
        await c.query(
          "UPDATE tickets SET status='pending_review',lifecycle_state='off_site',closed_at=$2,closed_by_id=$3,updated_at=$4 WHERE id=$1",
          [
            current.openTicketId,
            quote.period.cutoffExclusive,
            context.userId,
            now(),
          ],
        );
        await c.query(
          "INSERT INTO ticket_status_history(ticket_id,from_status,to_status,actor_user_id,actor_role,reason) VALUES($1,'initiated','pending_review',$2,'vendor','Completed Gate post billing period closed for office review')",
          [current.openTicketId, context.userId],
        );
        await c.query("UPDATE tickets SET status='submitted' WHERE id=$1", [
          current.openTicketId,
        ]);
        await c.query(
          "INSERT INTO ticket_status_history(ticket_id,from_status,to_status,actor_user_id,actor_role,reason) VALUES($1,'pending_review','submitted',$2,'vendor',$3)",
          [
            current.openTicketId,
            context.userId,
            `${executionSource === "scheduled" ? "Explicit scheduled direction" : "Office review"}: ${context.station.name} daily coverage through ${quote.period.throughDay}; partner approval required`,
          ],
        );
        const nextTicketId = input.continueBilling
          ? await newTicket(
              c,
              session,
              context,
              current.workTypeId,
              quote.period.nextPeriodStartDay,
            )
          : null;
        const saved = ConfigSchema.parse({
          ...current,
          ...(input.continueBilling ? continuationTerms : {}),
          version: current.version + 1,
          periodStartDay: quote.period.nextPeriodStartDay,
          openTicketId: nextTicketId,
          lastBilledThroughDay: quote.period.throughDay,
          autoInvoiceEveryDays: input.continueBilling
            ? current.autoInvoiceEveryDays
            : null,
          directionActor: input.continueBilling ? current.directionActor : null,
        });
        const result: BillingResult = {
          status: "submitted",
          ticketId: current.openTicketId,
          nextTicketId,
          billedThroughDay: quote.period.throughDay,
          invoiceStatus: "awaiting_partner_approval",
        };
        await append(c, session, "gate-billing-config", stationId, saved);
        await append(
          c,
          session,
          "gate-billing-ticket",
          String(current.openTicketId),
          {
            stationId,
            agreement: publicConfig(current),
            period: quote.period,
            officeUserId: context.userId,
            reviewedAt: now().toISOString(),
            coverageGapAcknowledged: input.acknowledgeCoverageGaps,
            executionSource,
            invoiceStatus: result.invoiceStatus,
          },
        );
        await append(c, session, "gate-billing-operation", input.operationId, {
          fingerprint,
          stationId,
          kind: "invoice_now",
          recordedAt: now().toISOString(),
          result,
        });
        return result;
      }),
  };
  const runDue = async (): Promise<
    Array<{
      stationId: string;
      status: "submitted" | "not_due" | "review_required";
    }>
  > => {
    const outcomes: Array<{
      stationId: string;
      status: "submitted" | "not_due" | "review_required";
    }> = [];
    let after = 0;
    for (;;) {
      const rows = (
        await pool.query(
          "SELECT id,tool_output FROM (SELECT DISTINCT ON(vendor_id,target_id) id,tool_output FROM assistant_action_audit WHERE target_type='gate-billing-config' ORDER BY vendor_id,target_id,id DESC) latest WHERE id>$1 AND tool_output->>'autoInvoiceEveryDays' IS NOT NULL AND tool_output->>'openTicketId' IS NOT NULL ORDER BY id LIMIT 100",
          [after],
        )
      ).rows;
      if (!rows.length) break;
      for (const row of rows) {
        after = Math.max(after, Number(row.id));
        const candidate = ConfigSchema.safeParse(row.tool_output);
        if (!candidate.success || !candidate.data.directionActor) continue;
        const saved = candidate.data,
          actor = saved.directionActor!;
        try {
          // A saved company billing direction is not a temporary login token.
          // Refresh only this same approved principal's session version. The
          // exact employer/membership/role are still checked in every command;
          // revocation/suspension never switches to another office identity.
          const current = (
            await pool.query("SELECT session_version FROM users WHERE id=$1", [
              actor.userId,
            ])
          ).rows[0];
          if (!current) fail("office_required", 403);
          const currentActor = {
            ...actor,
            sv: current.session_version as number,
          };
          const quote = await basic.preview(currentActor, saved.stationId);
          // The scan is only a candidate list. A changed/disabled direction
          // cannot acquire a new current quote and execute the old instruction.
          if (
            quote.config.version !== saved.version ||
            quote.config.autoInvoiceEveryDays !== saved.autoInvoiceEveryDays
          ) {
            outcomes.push({ stationId: saved.stationId, status: "not_due" });
            continue;
          }
          if (
            quote.period.days.length < (saved.autoInvoiceEveryDays ?? Infinity)
          ) {
            outcomes.push({ stationId: saved.stationId, status: "not_due" });
            continue;
          }
          const hex = digest({
              purpose: "gate-daily-billing-schedule",
              stationId: saved.stationId,
              version: quote.config.version,
              cutoff: quote.period.cutoffExclusive,
            }),
            operationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
          const result = await basic.invoiceNow(
            currentActor,
            saved.stationId,
            {
              operationId,
              expectedVersion: quote.config.version,
              previewFingerprint: quote.fingerprint,
              continueBilling: true,
              acknowledgeCoverageGaps: false,
              minimumCompletedDays: saved.autoInvoiceEveryDays,
            },
            "scheduled",
          );
          outcomes.push({ stationId: saved.stationId, status: result.status });
        } catch (error) {
          outcomes.push({
            stationId: saved.stationId,
            status: "review_required",
          });
          const code =
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "gate_billing.automatic_review_required";
          // A failure retains billing work and records an office exception; it
          // never supplies a different principal or retries with broader grants.
          await changeOverTransaction(async (c) => {
            const prior = await readRecord(
              c,
              saved.vendorId,
              "gate-billing-schedule-exception",
              saved.stationId,
            );
            if (prior?.configVersion === saved.version && prior.code === code)
              return;
            await append(
              c,
              {
                ...actor,
                userId: (
                  await c.query("SELECT id FROM users WHERE id=$1", [
                    actor.userId,
                  ])
                ).rows[0]?.id,
              },
              "gate-billing-schedule-exception",
              saved.stationId,
              {
                configVersion: saved.version,
                code,
                recordedAt: now().toISOString(),
                executionSource: "scheduled",
                outcome: "not_confirmed",
              },
            );
          });
        }
      }
      if (rows.length < 100) break;
    }
    return outcomes;
  };
  return { ...basic, runDue };
}
export const gateDailyBillingService = createGateDailyBillingService();
