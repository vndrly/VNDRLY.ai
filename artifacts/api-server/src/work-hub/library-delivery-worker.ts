import { and, eq, sql, desc } from "drizzle-orm";
import {
  db,
  workHubFormInstancesTable as instances,
  workHubFormTemplatesTable as templates,
} from "@workspace/db";
import {
  AssignmentMetadataSchema,
  LibraryMetadataSchema,
  type WorkHubOwner,
} from "@workspace/api-zod";
import { companyLibraryPeople } from "./library-audience";
import { queueCampaignNotice } from "./form-campaign-service";
import { libraryDueWork } from "./library-schedule";
let running = false;
export async function runLibraryDeliveryWork(now = new Date()) {
  if (running) return 0;
  running = true;
  try {
    const candidates = await db
      .select({ id: instances.id, templateId: instances.templateId })
      .from(instances)
      .where(
        sql`${instances.assignmentMetadata}->'delivery' is not null AND ${instances.assignmentMetadata}->'delivery' <> 'null'::jsonb AND coalesce((${instances.assignmentMetadata}->'delivery'->>'nextScanAt')::timestamptz,'1970-01-01')<=${now}`,
      )
      .orderBy(
        sql`coalesce(${instances.assignmentMetadata}->'delivery'->>'nextScanAt','1970-01-01')`,
        instances.createdAt,
      )
      .limit(50);
    let processed = 0;
    for (const candidate of candidates) {
      try {
        await db.transaction(async (tx) => {
          const [template] = await tx
            .select()
            .from(templates)
            .where(eq(templates.id, candidate.templateId))
            .limit(1)
            .for("update");
          const [instance] = await tx
            .select()
            .from(instances)
            .where(eq(instances.id, candidate.id))
            .limit(1)
            .for("update", { skipLocked: true });
          if (!template?.libraryMetadata || !instance?.assignmentMetadata)
            return;
          const a = AssignmentMetadataSchema.parse(instance.assignmentMetadata),
            d = a.delivery,
            m = LibraryMetadataSchema.parse(template.libraryMetadata);
          if (!d || (d.nextScanAt && Date.parse(d.nextScanAt) > now.getTime()))
            return;
          const owner = {
            type: template.ownerOrgType,
            id: template.ownerOrgId,
          } as WorkHubOwner;
          const people = await companyLibraryPeople(tx, owner, true),
            employee = people.find(
              (p) =>
                p.userId === instance.assigneeUserId &&
                p.membershipId === a.membershipId,
            ),
            administrator = people.find(
              (p) => p.userId === d.ownerUserId && p.role === "admin",
            );
          if (
            !employee ||
            !administrator ||
            ["cancelled", "exempted"].includes(a.status)
          )
            a.delivery = null;
          else {
            const due = libraryDueWork(m.kind, a, now)!;
            const owned = await tx
              .select({ instance: instances })
              .from(instances)
              .innerJoin(templates, eq(templates.id, instances.templateId))
              .where(
                and(
                  eq(templates.ownerOrgType, owner.type),
                  eq(templates.ownerOrgId, owner.id),
                  sql`${instances.assignmentMetadata}->>'sourceItemId'=${a.sourceItemId}`,
                ),
              )
              .orderBy(desc(instances.createdAt));
            const latest = new Map<
              string,
              (typeof owned)[number]["instance"]
            >();
            for (const row of owned) {
              const value = AssignmentMetadataSchema.parse(
                row.instance.assignmentMetadata,
              );
              if (
                !people.some(
                  (p) =>
                    p.userId === row.instance.assigneeUserId &&
                    p.membershipId === value.membershipId,
                )
              )
                continue;
              const key = `${row.instance.templateId}:${row.instance.assigneeUserId}`;
              if (!latest.has(key)) latest.set(key, row.instance);
            }
            const active = [...latest.values()]
                .map((row) =>
                  AssignmentMetadataSchema.parse(row.assignmentMetadata),
                )
                .filter((value) => value.status !== "cancelled"),
              responded = active.filter(
                (value) => value.status === "completed",
              ).length,
              pending = active.filter((value) =>
                ["assigned", "in_progress"].includes(value.status),
              ),
              overdue = pending.filter(
                (value) => Date.parse(value.dueAt) <= now.getTime(),
              ).length;
            const link = `/work-hub/${a.bundleId ? "bundle" : "library"}/${a.sourceItemId}`;
            const body = `${responded} of ${active.length} completed; ${pending.length} outstanding, ${overdue} overdue.`;
            const summary = async (key: string, title: string, push = true) =>
              queueCampaignNotice(tx, {
                userIds: [d.ownerUserId],
                key,
                type: "work_hub_library_summary",
                title,
                body,
                link,
                at: now,
                timezone: d.timezone,
                push,
              });
            if (due.reminder) {
              await queueCampaignNotice(tx, {
                userIds: [employee.userId],
                key: `library-reminder:${instance.id}:${d.nextReminderAt}`,
                type: "work_hub_library_assignment",
                title: overdue
                  ? "Work Hub assignment overdue"
                  : "Work Hub assignment reminder",
                body: template.name,
                link: `/work-hub/${m.kind === "training" ? "training" : "checklist"}/${instance.id}`,
                at: now,
                timezone: d.timezone,
              });
              d.nextReminderAt = d.config.reminderHours
                ? new Date(
                    now.getTime() + d.config.reminderHours * 3600000,
                  ).toISOString()
                : null;
            }
            if (due.briefingDate) {
              await summary(
                `library-brief:${a.sourceItemId}:${d.ownerUserId}:${due.briefingDate}`,
                `Daily assignment briefing: ${template.name}`,
                d.config.briefing.push,
              );
              d.lastBriefingDate = due.briefingDate;
            }
            if (due.deadlineNotice && !d.deadlineNotifiedAt) {
              await summary(
                `library-deadline:${a.sourceItemId}:${d.ownerUserId}:${a.dueAt}`,
                `Assignment deadline: ${template.name}`,
              );
              d.deadlineNotifiedAt = now.toISOString();
            }
            if (due.escalate && !d.escalatedAt) {
              if (overdue)
                await summary(
                  `library-escalation:${a.sourceItemId}:${d.ownerUserId}`,
                  `Overdue assignments: ${template.name}`,
                );
              d.escalatedAt = now.toISOString();
            }
            if (!pending.length && d.config.briefing.enabled)
              await summary(
                `library-complete:${a.sourceItemId}:${d.ownerUserId}`,
                `Assigned work completed: ${template.name}`,
                d.config.briefing.push,
              );
            d.nextScanAt = new Date(now.getTime() + 60000).toISOString();
            if (
              !pending.length ||
              (m.kind === "poll" && now.getTime() >= Date.parse(a.dueAt)) ||
              (now.getTime() >=
                Date.parse(a.dueAt) +
                  (d.config.escalationHours ?? 0) * 3600000 &&
                (!d.config.escalationHours || d.escalatedAt))
            )
              a.delivery = null;
          }
          await tx
            .update(instances)
            .set({ assignmentMetadata: a })
            .where(eq(instances.id, instance.id));
          processed++;
        });
      } catch {
        console.error("Work Hub assignment delivery deferred", candidate.id);
      }
    }
    return processed;
  } finally {
    running = false;
  }
}
