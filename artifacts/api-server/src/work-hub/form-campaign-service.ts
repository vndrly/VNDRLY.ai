import { campaignPushAfterQuietHours } from "./form-campaign-schedule";
import {
  projectCampaignReceipts,
  publicCampaignState,
} from "./form-campaign-projection";
import { createHash } from "node:crypto";
import { getObjectStore } from "../lib/objectStore";
import { and, eq, inArray, isNull, desc, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  userOrgMembershipsTable as memberships,
  workHubFormTemplatesTable as templates,
  workHubFormInstancesTable as instances,
  workHubFormSubmissionsTable as submissions,
  workHubAuditLogTable as audit,
  notificationsTable as notices,
  notificationPreferencesTable as preferences,
  workHubFilesTable as files,
} from "@workspace/db";
import {
  FormCampaignConfigSchema,
  FormCampaignStateSchema,
  FormCampaignResponseSchema,
  FormCampaignReceiptSchema,
  type FormCampaignConfig,
  type FormCampaignState,
  type WorkHubCommandEnvelope,
  type WorkHubOwner,
} from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { WorkHubAccessError } from "./context-access";
import { executeWorkHubCommand } from "./commands";
import {
  liveMeetingFingerprint,
  verifyLiveMeetingReplay,
} from "./live-meeting-fingerprint";
import { campaignActorCurrent } from "./form-campaign-access";
import {
  requireCampaignPublicationContent,
  campaignDeadline,
  campaignCanSubmit,
  validateCampaignResponse,
  validateGeneralCampaignValues,
  generalCampaignFields,
  campaignResultsVisible,
} from "./form-campaign-policy";
export type CampaignActor = SessionPayload & {
  userId: number;
  source?: "web" | "ios" | "askv";
};
export type CampaignTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;
export class CampaignError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}
function problem(message: string, status = 409): never {
  throw new CampaignError(message, status);
}
export function campaignOwner(actor: CampaignActor): WorkHubOwner {
  if (actor.partnerId) return { type: "partner", id: actor.partnerId };
  if (actor.vendorId) return { type: "vendor", id: actor.vendorId };
  throw new WorkHubAccessError("forbidden");
}
export async function campaignMember(
  reader: Reader,
  actor: CampaignActor,
  owner: WorkHubOwner,
  lock = false,
) {
  const uq = reader
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, actor.userId))
    .limit(1);
  const [user] = await (lock ? uq.for("share") : uq);
  const mq = reader
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, actor.userId),
        eq(memberships.orgType, owner.type),
        owner.type === "vendor"
          ? eq(memberships.vendorId, owner.id)
          : eq(memberships.partnerId, owner.id),
      ),
    )
    .limit(1);
  const [member] = await (lock ? mq.for("share") : mq);
  if (!campaignActorCurrent(actor, user, member, owner))
    throw new WorkHubAccessError("forbidden");
  return member;
}
export async function campaignRecord(reader: Reader, id: string, lock = false) {
  const q = reader
    .select()
    .from(templates)
    .where(eq(templates.id, id))
    .limit(1);
  const [record] = await (lock ? q.for("update") : q);
  if (!record?.campaignConfig) throw new WorkHubAccessError("not_found");
  return {
    record,
    config: FormCampaignConfigSchema.parse(record.campaignConfig),
    state: FormCampaignStateSchema.parse(record.campaignState ?? {}),
  };
}
async function context(
  reader: Reader,
  actor: CampaignActor,
  id: string,
  lock = false,
) {
  const owner = campaignOwner(actor),
    member = await campaignMember(reader, actor, owner, lock),
    camp = await campaignRecord(reader, id, lock);
  if (
    camp.record.ownerOrgType !== owner.type ||
    camp.record.ownerOrgId !== owner.id
  )
    throw new WorkHubAccessError("not_found");
  return {
    ...camp,
    owner,
    member,
    manage: member.role === "admin" || camp.record.createdById === actor.userId,
  };
}
export async function campaignAudience(
  reader: Reader,
  owner: WorkHubOwner,
  ids?: number[],
  lock = false,
) {
  if (ids && !ids.length) return [];
  const q = reader
    .select({
      userId: usersTable.id,
      name: usersTable.displayName,
      email: usersTable.email,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(usersTable, eq(usersTable.id, memberships.userId))
    .where(
      and(
        eq(memberships.orgType, owner.type),
        owner.type === "vendor"
          ? eq(memberships.vendorId, owner.id)
          : eq(memberships.partnerId, owner.id),
        isNull(usersTable.suspendedAt),
        ids ? inArray(usersTable.id, ids) : undefined,
      ),
    )
    .orderBy(usersTable.id)
    .limit(5001);
  const rows = await (lock ? q.for("share") : q);
  if (rows.length > 5000)
    problem(
      "This audience exceeds the supported batch size; select a smaller audience",
      400,
    );
  return [...new Map(rows.map((r) => [r.userId, r])).values()];
}
export function campaignDefinition(config: FormCampaignConfig) {
  return config.kind === "acknowledgement"
    ? [
        {
          id: "acknowledged",
          label: "I have read and acknowledge this policy",
          type: "checkbox",
          required: true,
        },
      ]
    : config.kind === "poll"
      ? [
          {
            id: "choices",
            label: config.question || config.title,
            type: "choice",
            required: true,
            choices: config.choices,
            maxSelections: config.maxSelections,
          },
        ]
      : [];
}
export async function queueCampaignNotice(
  tx: CampaignTx,
  input: {
    userIds: number[];
    key: string;
    title: string;
    body: string;
    link: string;
    at: Date;
    push?: boolean;
    timezone?: string;
    type?:string;
    metadata?: Record<string, unknown>;
  },
) {
  for (const userId of [...new Set(input.userIds)]) {
    const [prefs] = await tx
      .select()
      .from(preferences)
      .where(eq(preferences.userId, userId))
      .limit(1);
    let next: Date | null =
      input.push === false ||
      prefs?.pushEnabled === false ||
      prefs?.workHubTasksEnabled === false
        ? null
        : input.at;
    if (
      next &&
      prefs?.dndStartHour != null &&
      prefs.dndEndHour != null &&
      prefs.dndStartHour !== prefs.dndEndHour
    ) {
      next = campaignPushAfterQuietHours(
        next,
        prefs.dndStartHour,
        prefs.dndEndHour,
        input.timezone ?? "America/Chicago",
      );
    }
    await tx
      .insert(notices)
      .values({
        userId,
        type: input.type??"work_hub_form_campaign",
        category: "work_hub_tasks",
        title: input.title,
        body: input.body,
        link: input.link,
        dedupeKey: `campaign:${input.key}`,
        nextDeliveryAttemptAt: next,
        deliveryStatus: next ? "pending" : "in_app_only",
      })
      .onConflictDoNothing();
  }
}
export async function assignCampaignAudience(
  tx: CampaignTx,
  camp: Awaited<ReturnType<typeof campaignRecord>>,
  owner: WorkHubOwner,
  now: Date,
) {
  const people = await campaignAudience(
    tx,
    owner,
    camp.config.audience.mode === "selected"
      ? camp.config.audience.userIds
      : undefined,
    true,
  );
  if (
    camp.config.audience.mode === "selected" &&
    camp.config.audience.userIds.some(
      (id) => !people.some((p) => p.userId === id),
    )
  )
    problem("An audience member is no longer eligible", 400);
  const existing = await tx
    .select({ userId: instances.assigneeUserId })
    .from(instances)
    .where(
      and(
        eq(instances.templateId, camp.record.id),
        eq(instances.campaignVersion, camp.record.currentVersion),
      ),
    );
  for (const person of people.filter(
    (p) => !existing.some((i) => i.userId === p.userId),
  )) {
    const [instance] = await tx
      .insert(instances)
      .values({
        templateId: camp.record.id,
        templateVersion: camp.record.currentVersion,
        campaignVersion: camp.record.currentVersion,
        definitionSnapshot: camp.record.definition,
        assigneeUserId: person.userId,
        dueAt: camp.state.deadline ? new Date(camp.state.deadline) : null,
      })
      .returning();
    await queueCampaignNotice(tx, {
      userIds: [person.userId],
      key: `invite:${instance.id}`,
      title:
        camp.config.kind === "poll" ? "New company poll" : "New required form",
      body: camp.config.title,
      link: `/work-hub/form/${instance.id}`,
      at: now,
      timezone: camp.config.timezone,
    });
  }
  return people.length;
}
async function command(
  actor: CampaignActor,
  id: string | null,
  e: WorkHubCommandEnvelope,
  kind: string,
  payload: unknown,
  apply: (
    tx: CampaignTx,
    camp: Awaited<ReturnType<typeof context>> | null,
  ) => Promise<Record<string, unknown>>,
  manage = true,
) {
  const owner = campaignOwner(actor);
  if (
    e.owner.type !== owner.type ||
    e.owner.id !== owner.id ||
    e.context.kind !== "organization" ||
    e.context.id !== owner.id
  )
    throw new WorkHubAccessError("forbidden");
  const fingerprint = liveMeetingFingerprint(actor.userId, kind, id ?? "new", {
    ...e,
    payload,
  });
  const result = await executeWorkHubCommand(
    { userId: actor.userId, source: actor.source ?? "web" },
    kind,
    e,
    async (tx) => {
      const camp = id ? await context(tx, actor, id, true) : null;
      if (camp && camp.state.version !== e.expectedVersion)
        problem("Campaign changed; refresh before acting");
      const resource = await apply(tx, camp);
      await tx.insert(audit).values({
        actorUserId: actor.userId,
        ownerOrgType: owner.type,
        ownerOrgId: owner.id,
        action: kind,
        subjectType: "form_campaign",
        subjectId: id ?? String(resource.campaignId),
        operationId: e.operationId,
        source: actor.source ?? "web",
        metadata: { version: e.expectedVersion },
      });
      return { ...resource, commandFingerprint: fingerprint };
    },
    async (tx) => {
      const member = await campaignMember(tx, actor, owner, true);
      if (id) {
        const c = await context(tx, actor, id, true);
        if (manage && !c.manage) throw new WorkHubAccessError("forbidden");
      } else if (member.role !== "admin")
        throw new WorkHubAccessError("forbidden");
    },
  );
  verifyLiveMeetingReplay(result, fingerprint);
  return result;
}
async function campaignSourceDefinition(
  tx: CampaignTx,
  owner: WorkHubOwner,
  config: FormCampaignConfig,
) {
  if (config.kind !== "form") return campaignDefinition(config);
  const [source] = await tx
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.id, config.sourceTemplateId!),
        eq(templates.ownerOrgType, owner.type),
        eq(templates.ownerOrgId, owner.id),
        isNull(templates.campaignConfig),isNull(templates.libraryMetadata),
      ),
    )
    .limit(1)
    .for("share");
  if (!source) problem("Company source form not found", 404);
  try {
    return generalCampaignFields(source.definition);
  } catch (e) {
    problem(e instanceof Error ? e.message : "Unsupported source form", 400);
  }
}
export async function createCampaign(
  actor: CampaignActor,
  e: WorkHubCommandEnvelope,
) {
  const config = FormCampaignConfigSchema.parse(e.payload);

  return command(actor, null, e, "campaign.create", config, async (tx) => {
    const owner = campaignOwner(actor),
      state = FormCampaignStateSchema.parse({});
    const [record] = await tx
      .insert(templates)
      .values({
        ownerOrgType: owner.type,
        ownerOrgId: owner.id,
        name: config.title,
        definition: await campaignSourceDefinition(tx, owner, config),
        createdById: actor.userId,
        campaignConfig: config,
        campaignState: state,
      })
      .returning();
    return {
      campaignId: record.id,
      config,
      state: publicCampaignState(state),
      notificationState: "none",
    };
  });
}
export async function updateCampaign(
  actor: CampaignActor,
  id: string,
  e: WorkHubCommandEnvelope,
) {
  const config = FormCampaignConfigSchema.parse(e.payload);
  return command(actor, id, e, "campaign.update", config, async (tx, c) => {
    if (!c || c.state.status !== "draft")
      problem(
        "Published policy and poll content cannot be edited; create a new campaign version",
      );
    const state = { ...c.state, version: c.state.version + 1 };
    await tx
      .update(templates)
      .set({
        name: config.title,
        definition: await campaignSourceDefinition(
          tx,
          campaignOwner(actor),
          config,
        ),
        campaignConfig: config,
        campaignState: state,
      })
      .where(eq(templates.id, id));
    return { campaignId: id, config, state: publicCampaignState(state) };
  });
}
export async function publishCampaign(
  actor: CampaignActor,
  id: string,
  e: WorkHubCommandEnvelope,
  at?: Date,
) {
  return command(actor, id, e, "campaign.publish", {}, async (tx, c) => {
    const now = at ?? new Date();
    if (!c || c.state.status !== "draft")
      problem("Campaign is already published or closed");
    try {
      requireCampaignPublicationContent(c.config);
    } catch (e) {
      problem(e instanceof Error ? e.message : "Policy content required", 400);
    }
    let attachment: FormCampaignState["policyAttachmentSnapshot"] = null;
    if (c.config.policyAttachmentId) {
      const [file] = await tx
        .select()
        .from(files)
        .where(
          and(
            eq(files.id, c.config.policyAttachmentId),
            eq(files.ownerOrgType, c.owner.type),
            eq(files.ownerOrgId, c.owner.id),
          ),
        )
        .limit(1);
      if (
        !file ||
        file.state !== "finalized" ||
        file.channelId ||
        file.byteSize > 25 * 1024 * 1024
      )
        throw new WorkHubAccessError("forbidden");
      const store = getObjectStore(),
        object = await store.getObject(file.storageKey);
      if (
        !object ||
        createHash("sha256").update(object.body).digest("hex") !==
          file.checksumSha256 ||
        object.body.length !== file.byteSize
      )
        problem("Policy attachment could not be verified", 400);
      const storageKey = `/objects/work-hub-policy-snapshots/${id}/${c.record.currentVersion}/${file.checksumSha256}`;
      await store.putObject(storageKey, file.contentType, object.body, {
        owner: String(actor.userId),
        visibility: "private",
      });
      attachment = {
        storageKey,
        checksumSha256: file.checksumSha256,
        fileName: file.fileName,
        contentType: file.contentType,
        byteSize: file.byteSize,
      };
    }
    if (c.config.escalation) {
      const recipients = await campaignAudience(
        tx,
        c.owner,
        [c.config.escalation.userId],
        true,
      );
      if (!recipients.some((p) => p.role === "admin"))
        problem("Choose an active company administrator for escalation", 400);
    }
    const deadline = campaignDeadline(c.config, now),
      state: FormCampaignState = {
        ...c.state,
        status: "published",
        version: c.state.version + 1,
        publishedAt: now.toISOString(),
        nextWorkAt: now.toISOString(),
        policyAttachmentSnapshot: attachment,
        deadline: deadline.toISOString(),
        nextReminderAt: c.config.reminderHours
          ? new Date(
              now.getTime() + c.config.reminderHours * 3600000,
            ).toISOString()
          : null,
        nextAudienceAt: c.config.audience.rolling
          ? new Date(now.getTime() + 60000).toISOString()
          : null,
      };
    const count = await assignCampaignAudience(
      tx,
      { ...c, state },
      c.owner,
      now,
    );
    if (!count) problem("No eligible audience members", 400);
    await tx
      .update(templates)
      .set({ campaignState: state })
      .where(eq(templates.id, id));
    return {
      campaignId: id,
      state: publicCampaignState(state),
      audienceCount: count,
      notificationState: "queued",
    };
  });
}
export async function pauseCampaign(
  actor: CampaignActor,
  id: string,
  e: WorkHubCommandEnvelope,
) {
  return command(actor, id, e, "campaign.pause", {}, async (tx, c) => {
    if (!c || c.state.status === "draft")
      problem("Publish the campaign before pausing it");
    const state = {
      ...c.state,
      status: "paused" as const,
      version: c.state.version + 1,
    };
    await tx
      .update(templates)
      .set({ campaignState: state })
      .where(eq(templates.id, id));
    return { campaignId: id, state: publicCampaignState(state) };
  });
}
export async function campaignProgress(
  reader: Reader,
  camp: Awaited<ReturnType<typeof campaignRecord>>,
  owner: WorkHubOwner,
  now = new Date(),
) {
  const assigned = await reader
    .select()
    .from(instances)
    .where(eq(instances.templateId, camp.record.id));
  const people = await campaignAudience(
    reader,
    owner,
    assigned.flatMap((i) => (i.assigneeUserId ? [i.assigneeUserId] : [])),
  );
  const raw = assigned.length
    ? await reader
        .select()
        .from(submissions)
        .where(
          inArray(
            submissions.instanceId,
            assigned.map((i) => i.id),
          ),
        )
        .orderBy(desc(submissions.version))
    : [];
  const latest = new Map<string, (typeof raw)[number]>();
  for (const row of raw)
    if (!latest.has(row.instanceId)) latest.set(row.instanceId, row);
  const eligible = assigned.filter((i) =>
      people.some((p) => p.userId === i.assigneeUserId),
    ),
    responded = eligible.filter((i) => latest.has(i.id)),
    pending = eligible.filter((i) => !latest.has(i.id));
  const overdue =
    !!camp.state.deadline && now.getTime() >= Date.parse(camp.state.deadline)
      ? pending.length
      : 0;
  const counts = {
    assigned: assigned.length,
    eligible: eligible.length,
    responded: responded.length,
    pending: pending.length,
    overdue,
    excluded: assigned.length - eligible.length,
  };
  return { assigned, eligible, pending, people, latest, counts };
}
export async function getCampaign(
  actor: CampaignActor,
  id: string,
  now = new Date(),
) {
  const c = await context(db, actor, id);
  if (!c.manage) throw new WorkHubAccessError("forbidden");
  const p = await campaignProgress(db, c, c.owner, now);
  const visible = campaignResultsVisible(c.config, c.state, now);
  const totals =
    c.config.kind === "poll" && visible
      ? c.config.choices.map((choice) => ({
          ...choice,
          votes: p.eligible.filter((i) => {
            const v = p.latest.get(i.id)?.values.choices;
            return Array.isArray(v) && v.includes(choice.id);
          }).length,
        }))
      : null;
  const receipts = projectCampaignReceipts(
    c.config,
    c.state,
    p.assigned,
    p.people,
    p.latest,
    visible,
  );
  const briefings = await db
    .select({
      id: notices.id,
      title: notices.title,
      body: notices.body,
      createdAt: notices.createdAt,
      deliveryStatus: notices.deliveryStatus,
    })
    .from(notices)
    .where(
      and(
        eq(notices.type, "work_hub_form_campaign"),
        eq(notices.link, `/work-hub/campaign/${id}`),
        sql`${notices.dedupeKey} like ${`campaign:briefing:${id}:%`}`,
      ),
    )
    .orderBy(desc(notices.createdAt))
    .limit(30);
  return {
    publicationPreview:
      c.state.status === "draft"
        ? {
            audienceCount: (
              await campaignAudience(
                db,
                c.owner,
                c.config.audience.mode === "selected"
                  ? c.config.audience.userIds
                  : undefined,
              )
            ).length,
            estimatedDeadline: campaignDeadline(c.config, now).toISOString(),
            timezone: c.config.timezone,
          }
        : null,
    definition: c.record.definition,
    briefings,
    campaignId: id,
    config: c.config,
    state: publicCampaignState(c.state),
    canManage: true,
    counts: p.counts,
    resultsVisible: visible,
    totals,
    receipts,
  };
}
export async function listCampaigns(actor: CampaignActor) {
  const owner = campaignOwner(actor),
    member = await campaignMember(db, actor, owner);
  const rows = await db
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.ownerOrgType, owner.type),
        eq(templates.ownerOrgId, owner.id),
        sql`${templates.campaignConfig} is not null`,
      ),
    )
    .orderBy(desc(templates.createdAt))
    .limit(100);
  const assigned = rows.length
    ? await db
        .select()
        .from(instances)
        .where(
          and(
            inArray(
              instances.templateId,
              rows.map((r) => r.id),
            ),
            eq(instances.assigneeUserId, actor.userId),
          ),
        )
    : [];
  const responses = assigned.length ? await db.select({instanceId: submissions.instanceId}).from(submissions).where(inArray(submissions.instanceId, assigned.map(i=>i.id))) : [];
  const responded = new Set(responses.map(r=>r.instanceId));
  return rows
    .filter(
      (r) =>
        member.role === "admin" ||
        r.createdById === actor.userId ||
        assigned.some((i) => i.templateId === r.id),
    )
    .map((r) => {
      const state = FormCampaignStateSchema.parse(r.campaignState ?? {}),
        config = FormCampaignConfigSchema.parse(r.campaignConfig);
      return {
        campaignId: r.id,
        title: r.name,
        kind: config.kind,
        state: publicCampaignState(state),
        canManage: member.role === "admin" || r.createdById === actor.userId,
        instanceId: assigned.find((i) => i.templateId === r.id)?.id ?? null,
        completed: assigned.some(i=>i.templateId === r.id && responded.has(i.id)),
      };
    });
}
export async function getCampaignInstance(
  actor: CampaignActor,
  instanceId: string,
  now = new Date(),
) {
  const [instance] = await db
    .select()
    .from(instances)
    .where(
      and(
        eq(instances.id, instanceId),
        eq(instances.assigneeUserId, actor.userId),
      ),
    )
    .limit(1);
  if (!instance?.campaignVersion) throw new WorkHubAccessError("not_found");
  const c = await context(db, actor, instance.templateId);
  const [last] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.instanceId, instanceId))
    .orderBy(desc(submissions.version))
    .limit(1);
  const {
    kind,
    title,
    description,
    question,
    policyText,
    policyVersion,
    policyAttachmentId,
    choices,
    maxSelections,
    anonymous,
    allowVoteChanges,
    resultsTiming,
    timezone,
  } = c.config;
  const visible = campaignResultsVisible(c.config, c.state, now);
  let totals = null;
  if (kind === "poll" && visible) {
    const p = await campaignProgress(db, c, c.owner, now);
    totals = choices.map((choice) => ({
      ...choice,
      votes: p.eligible.filter((i) => {
        const v = p.latest.get(i.id)?.values.choices;
        return Array.isArray(v) && v.includes(choice.id);
      }).length,
    }));
  }
  return {
    campaignId: c.record.id,
    instanceId,
    config: {
      kind,
      title,
      description,
      question,
      policyText,
      policyVersion,
      policyAttachmentId,
      choices,
      maxSelections,
      anonymous,
      allowVoteChanges,
      resultsTiming,
      timezone,
    },
    state: publicCampaignState(c.state),
    attachment: c.state.policyAttachmentSnapshot
      ? {
          fileName: c.state.policyAttachmentSnapshot.fileName,
          contentType: c.state.policyAttachmentSnapshot.contentType,
          byteSize: c.state.policyAttachmentSnapshot.byteSize,
        }
      : null,
    definition: instance.definitionSnapshot,
    version: last?.version ?? 0,
    canSubmit:
      campaignCanSubmit(c.config, c.state, now) &&
      (!last || (kind === "poll" && allowVoteChanges)),
    response: last
      ? {
          values: last.values,
          submittedAt: last.submittedAt.toISOString(),
          version: last.version,
        }
      : null,
    resultsVisible: visible,
    totals,
  };
}
export async function respondCampaign(
  actor: CampaignActor,
  instanceId: string,
  e: WorkHubCommandEnvelope,
  at?: Date,
) {
  const owner = campaignOwner(actor);
  if (
    e.owner.type !== owner.type ||
    e.owner.id !== owner.id ||
    e.context.kind !== "organization" ||
    e.context.id !== owner.id
  )
    throw new WorkHubAccessError("forbidden");
  const payload = FormCampaignResponseSchema.parse(e.payload),
    fingerprint = liveMeetingFingerprint(
      actor.userId,
      "campaign.respond",
      instanceId,
      { ...e, payload },
    );
  const authorize = async (tx: CampaignTx) => {
    await campaignMember(tx, actor, owner, true);
    const [instance] = await tx
      .select()
      .from(instances)
      .where(
        and(
          eq(instances.id, instanceId),
          eq(instances.assigneeUserId, actor.userId),
        ),
      )
      .limit(1);
    if (!instance?.campaignVersion) throw new WorkHubAccessError("not_found");
    const c = await context(tx, actor, instance.templateId, true);
    return { instance, c };
  };
  const result = await executeWorkHubCommand(
    { userId: actor.userId, source: actor.source ?? "web" },
    "campaign.respond",
    e,
    async (tx) => {
      const { instance, c } = await authorize(tx);
      const now = at ?? new Date();
      if (!campaignCanSubmit(c.config, c.state, now))
        problem("This campaign is not accepting responses");
      const [last] = await tx
        .select()
        .from(submissions)
        .where(eq(submissions.instanceId, instanceId))
        .orderBy(desc(submissions.version))
        .limit(1);
      if ((last?.version ?? 0) !== e.expectedVersion)
        problem("Response changed; refresh before submitting");
      if (last && (c.config.kind !== "poll" || !c.config.allowVoteChanges))
        problem("A response has already been submitted");
      let values: Record<string, unknown>;
      try {
        values =
          c.config.kind === "form"
            ? validateGeneralCampaignValues(
                instance.definitionSnapshot,
                payload.values ?? {},
              )
            : validateCampaignResponse(c.config, payload);
      } catch (e) {
        problem(e instanceof Error ? e.message : "Invalid response", 400);
      }
      const [saved] = await tx
        .insert(submissions)
        .values({
          instanceId,
          version: (last?.version ?? 0) + 1,
          priorSubmissionId: last?.id ?? null,
          submittedById: actor.userId,
          values,
          submittedAt: now,
        })
        .returning();
      const receipt = FormCampaignReceiptSchema.parse({
        campaignId: c.record.id,
        instanceId,
        submissionId: saved.id,
        submittedAt: saved.submittedAt.toISOString(),
        late:
          !!c.state.deadline && now.getTime() >= Date.parse(c.state.deadline),
        version: saved.version,
        policyVersion:
          c.config.kind === "acknowledgement" ? c.config.policyVersion : null,
      });
      await tx.insert(audit).values({
        actorUserId: actor.userId,
        ownerOrgType: owner.type,
        ownerOrgId: owner.id,
        action: "campaign.respond",
        subjectType: "form_instance",
        subjectId: instance.id,
        operationId: e.operationId,
        source: actor.source ?? "web",
        metadata: { campaignId: c.record.id, version: saved.version },
      });
      return { ...receipt, commandFingerprint: fingerprint };
    },
    async (tx) => {
      await authorize(tx);
    },
  );
  verifyLiveMeetingReplay(result, fingerprint);
  return result;
}

export async function campaignOptions(actor: CampaignActor) {
  const owner = campaignOwner(actor);
  await campaignMember(db, actor, owner);
  return {
    forms: await db
      .select({ id: templates.id, name: templates.name })
      .from(templates)
      .where(
        and(
          eq(templates.ownerOrgType, owner.type),
          eq(templates.ownerOrgId, owner.id),
          isNull(templates.campaignConfig),isNull(templates.libraryMetadata),
        ),
      )
      .limit(100),
    owner,
    people: await campaignAudience(db, owner),
    files: await db
      .select({ id: files.id, fileName: files.fileName })
      .from(files)
      .where(
        and(
          eq(files.ownerOrgType, owner.type),
          eq(files.ownerOrgId, owner.id),
          eq(files.state, "finalized"),
          isNull(files.channelId),
        ),
      )
      .limit(100),
  };
}

export async function campaignAttachment(
  actor: CampaignActor,
  instanceId: string,
) {
  const authorized = async () => {
    const [instance] = await db
      .select()
      .from(instances)
      .where(
        and(
          eq(instances.id, instanceId),
          eq(instances.assigneeUserId, actor.userId),
        ),
      )
      .limit(1);
    if (!instance?.campaignVersion) throw new WorkHubAccessError("not_found");
    return context(db, actor, instance.templateId);
  };
  const c = await authorized(),
    snapshot = c.state.policyAttachmentSnapshot;
  if (!snapshot) throw new WorkHubAccessError("not_found");
  const object = await getObjectStore().getObject(snapshot.storageKey);
  if (
    !object ||
    object.body.length !== snapshot.byteSize ||
    createHash("sha256").update(object.body).digest("hex") !==
      snapshot.checksumSha256
  )
    problem("Published policy attachment unavailable");
  await authorized();
  return { ...snapshot, body: object.body };
}
