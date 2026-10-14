import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  workHubFormTemplatesTable as templates,
  workHubFormInstancesTable as instances,
  usersTable,
  userOrgMembershipsTable as memberships,
  notificationsTable,
  notificationPreferencesTable,
  workHubFormSubmissionsTable,
} from "@workspace/db";
import {
  FormCampaignConfigSchema,
  FormCampaignStateSchema,
  type WorkHubOwner,
} from "@workspace/api-zod";
import { campaignDueWork } from "./form-campaign-schedule";
import {
  campaignAudience,
  campaignProgress,
  assignCampaignAudience,
  queueCampaignNotice,
} from "./form-campaign-service";
let timer: ReturnType<typeof setInterval> | null = null,
  running = false;
export async function runFormCampaignWork(now = new Date()) {
  if (running) return 0;
  running = true;
  try {
    return await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(templates)
        .where(
          sql`${templates.campaignConfig} is not null and ${templates.campaignState}->>'status' in ('published','closed') and coalesce((${templates.campaignState}->>'nextWorkAt')::timestamptz,'1970-01-01'::timestamptz) <= ${now}`,
        )
        .orderBy(
          sql`coalesce(${templates.campaignState}->>'nextWorkAt','1970-01-01')`,
          templates.createdAt,
        )
        .limit(25)
        .for("update", { skipLocked: true });
      let processed = 0;
      for (const record of rows) {
        const config = FormCampaignConfigSchema.parse(record.campaignConfig),
          state = FormCampaignStateSchema.parse(record.campaignState),
          owner = {
            type: record.ownerOrgType,
            id: record.ownerOrgId,
          } as WorkHubOwner,
          camp = { record, config, state },
          due = campaignDueWork(config, state, now);
        state.nextWorkAt = new Date(now.getTime() + 60000).toISOString();
        if (
          !due.close &&
          !due.expand &&
          !due.reminder &&
          !due.briefingDate &&
          !due.escalate &&
          (!due.deadlineNotice || state.deadlineNotifiedAt)
        ) {
          await tx
            .update(templates)
            .set({ campaignState: state })
            .where(eq(templates.id, record.id));
          continue;
        }
        const ownerMember = await campaignAudience(
          tx,
          owner,
          [record.createdById],
          true,
        );
        if (!ownerMember.length) {
          state.status = "paused";
          state.version++;
          await tx
            .update(templates)
            .set({ campaignState: state })
            .where(eq(templates.id, record.id));
          continue;
        }
        if (due.expand) {
          await assignCampaignAudience(tx, camp, owner, now);
          state.nextAudienceAt = new Date(now.getTime() + 60000).toISOString();
        }
        const progress = await campaignProgress(tx, camp, owner, now),
          counts = progress.counts;
        const ownerLink = `/work-hub/campaign/${record.id}`;
        if (due.reminder) {
          const occurrence = state.nextReminderAt!;
          for (const instance of progress.pending) {
            if (!instance.assigneeUserId) continue;
            await queueCampaignNotice(tx, {
              userIds: [instance.assigneeUserId],
              key: `reminder:${instance.id}:${occurrence}`,
              title: counts.overdue
                ? "Acknowledgement overdue"
                : "Form response reminder",
              body: config.title,
              link: `/work-hub/form/${instance.id}`,
              at: now,
              timezone: config.timezone,
            });
          }
          state.lastReminderAt = now.toISOString();
          state.nextReminderAt = config.reminderHours
            ? new Date(
                now.getTime() + config.reminderHours * 3600000,
              ).toISOString()
            : null;
        }
        if (due.briefingDate) {
          await queueCampaignNotice(tx, {
            userIds: [record.createdById],
            key: `briefing:${record.id}:${due.briefingDate}`,
            title: `Daily form briefing: ${config.title}`,
            body: `${counts.responded} of ${counts.eligible} responded; ${counts.pending} outstanding, ${counts.overdue} overdue, ${counts.excluded} excluded.`,
            link: ownerLink,
            at: now,
            timezone: config.timezone,
            push: config.briefing.push,
          });
          state.lastBriefingDate = due.briefingDate;
        }
        if (due.close) {
          state.status = "closed";
          state.closedAt = now.toISOString();
          state.nextAudienceAt = null;
          state.nextReminderAt = null;
        }
        if (due.deadlineNotice && !state.deadlineNotifiedAt) {
          await queueCampaignNotice(tx, {
            userIds: [record.createdById],
            key: `deadline:${record.id}`,
            title:
              config.kind === "poll"
                ? "Poll closed — results available"
                : "Policy acknowledgement deadline reached",
            body: `${config.title}: ${counts.responded} of ${counts.eligible} responded; ${counts.pending} outstanding.`,
            link: ownerLink,
            at: now,
            timezone: config.timezone,
          });
          state.deadlineNotifiedAt = now.toISOString();
        }
        if (due.escalate && config.escalation) {
          const recipient = await campaignAudience(
            tx,
            owner,
            [config.escalation.userId],
            true,
          );
          if (recipient.some((p) => p.role === "admin") && counts.overdue) {
            await queueCampaignNotice(tx, {
              userIds: [config.escalation.userId],
              key: `escalation:${record.id}`,
              title: "Overdue policy acknowledgements",
              body: `${config.title}: ${counts.overdue} employees still need follow-up.`,
              link: ownerLink,
              at: now,
              timezone: config.timezone,
            });
          }
          state.escalatedAt = now.toISOString();
        }
        state.version++;
        await tx
          .update(templates)
          .set({ campaignState: state })
          .where(eq(templates.id, record.id));
        processed++;
      }
      return processed;
    });
  } finally {
    running = false;
  }
}
export function startFormCampaignWorker() {
  if (timer) return;
  const run = () =>
    void runFormCampaignWork().catch(() =>
      console.error("Form campaign scheduled work unavailable"),
    );
  timer = setInterval(run, 60000);
  timer.unref?.();
  run();
}
export function stopFormCampaignWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
export async function formCampaignPushAllowed(userId: number, link: string) {
  const match = link.match(/^\/work-hub\/(form|campaign)\/([0-9a-f-]{36})$/i);
  if (!match) return false;
  let templateId = match[2];
  if (match[1] === "form") {
    const [instance] = await db
      .select()
      .from(instances)
      .where(
        and(eq(instances.id, match[2]), eq(instances.assigneeUserId, userId)),
      )
      .limit(1);
    if (!instance) return false;
    templateId = instance.templateId;
  }
  const [record] = await db
    .select()
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1);
  if (!record?.campaignConfig) return false;
  const state = FormCampaignStateSchema.parse(record.campaignState ?? {}),
    config = FormCampaignConfigSchema.parse(record.campaignConfig);
  const [prefs] = await db
    .select()
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userId, userId))
    .limit(1);
  if (prefs?.pushEnabled === false || prefs?.workHubTasksEnabled === false)
    return false;
  if (match[1] === "form") {
    if (
      state.status === "paused" ||
      state.status === "draft" ||
      (config.kind === "poll" &&
        (!state.deadline || Date.now() >= Date.parse(state.deadline)))
    )
      return false;
    const [answered] = await db
      .select({ id: workHubFormSubmissionsTable.id })
      .from(workHubFormSubmissionsTable)
      .where(eq(workHubFormSubmissionsTable.instanceId, match[2]))
      .limit(1);
    if (answered) return false;
  }
  const [member] = await db
    .select({ id: usersTable.id, role: memberships.role })
    .from(memberships)
    .innerJoin(usersTable, eq(usersTable.id, memberships.userId))
    .where(
      and(
        eq(usersTable.id, userId),
        isNull(usersTable.suspendedAt),
        eq(memberships.orgType, record.ownerOrgType),
        record.ownerOrgType === "vendor"
          ? eq(memberships.vendorId, record.ownerOrgId)
          : eq(memberships.partnerId, record.ownerOrgId),
      ),
    )
    .limit(1);
  return (
    !!member &&
    (match[1] === "form" ||
      member.role === "admin" ||
      record.createdById === userId)
  );
}
