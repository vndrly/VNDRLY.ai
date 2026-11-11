import { z } from "zod/v4";
export const crewNamePayload = z.object({ name: z.string().trim().min(1).max(120) });
export const crewMemberPayload = z.object({ mode: z.enum(["owner", "member"]).default("member") });
export const channelCreatePayload = z.object({ name: z.string().trim().min(1).max(120), visibility: z.enum(["organization", "private", "group"]).default("organization") });
export const templatePayload = z.object({ name: z.string().trim().min(1).max(200), definition: z.array(z.object({ id: z.string().min(1).max(80), label: z.string().trim().min(1).max(300), type: z.enum(["checkbox", "text", "number", "date", "choice"]), required: z.boolean().default(false) })).min(1).max(100) });
export const templateAssignmentPayload = z.object({ assigneeUserId: z.number().int().positive(), channelId: z.string().uuid().nullable().optional(), dueAt: z.iso.datetime().nullable().optional() });
export const checklistResponsePayload = z.object({ responses: z.record(z.string(), z.unknown()), complete: z.boolean().default(false) });
export const formResponsePayload = z.object({ values: z.record(z.string(), z.unknown()) });
export const approvalRequestPayload = z.object({ subjectType: z.string().min(1).max(80), subjectId: z.string().min(1).max(200), subjectVersion: z.number().int().positive().default(1), approverUserIds: z.array(z.number().int().positive()).min(1).max(50), mode: z.enum(["ordered", "parallel"]).default("ordered") });
export const approvalDecisionPayload = z.object({ decision: z.enum(["approved", "rejected"]), comment: z.string().max(5000).optional() });

export const shiftCreatePayload = z
      .object({
        title: z.string().trim().min(1).max(200),
        startsAt: z.iso.datetime(),
        endsAt: z.iso.datetime(),
        timezone: z.string().min(3).max(80),
        open: z.boolean().default(false),
        assigneeUserIds: z
          .array(z.number().int().positive())
          .max(500)
          .default([]),
        qualificationCodes: z.array(z.string().max(80)).max(50).default([]),
        recurrence: z.unknown().nullable().optional(),
        calendarType: z.enum(["company", "project"]).default("company"),
        projectName: z.string().trim().max(200).nullable().optional(),
        milestoneStatus: z
          .enum(["completed", "in_progress", "upcoming", "blocked", "overdue"])
          .default("upcoming"),
        percentComplete: z.number().int().min(0).max(100).default(0),
        instructions: z.string().trim().max(4000).nullable().optional(),
        dependencyTitle: z.string().trim().max(300).nullable().optional(),
        blockers: z.string().trim().max(2000).nullable().optional(),
        ownerUserId: z.number().int().positive().nullable().optional(),
        afeCode: z.string().trim().max(100).nullable().optional(),
        ticketNumber: z.string().trim().max(100).nullable().optional(),
        budgetAmount: z.number().nonnegative().nullable().optional(),
        budgetUsedAmount: z.number().nonnegative().nullable().optional(),
        invoicedAmount: z.number().nonnegative().nullable().optional(),
        invoiceReference: z.string().trim().max(100).nullable().optional(),
        sharedWithUserIds: z
          .array(z.number().int().positive())
          .max(500)
          .default([]),
        siteLocationId: z.number().int().positive().nullable().optional(),
        gateStationId: z.string().uuid().nullable().optional(),
        requiredStaffCount: z.number().int().min(1).max(20).nullable().optional(),
        workStartPolicy: z.enum(["on_site", "paid_travel"]).nullable().optional(),
      });
export const meetingCreatePayload = z
      .object({
        title: z.string().trim().min(1).max(200),
        agenda: z.string().max(50_000).nullable().optional(),
        startsAt: z.iso.datetime(),
        endsAt: z.iso.datetime().nullable().optional(),
        timezone: z.string().min(3).max(80),
        attendanceConfirmationRequired: z.boolean().default(false),
        admissionMode: z.enum(["company_open","host_approval"]).nullable().optional(),
        recordingAllowed: z.boolean().default(false),
        calendarEvent: z.boolean().default(false),
        participantUserIds: z
          .array(z.number().int().positive())
          .max(500)
          .default([]),
        recurrence: z.unknown().nullable().optional(),
      });
export const taskCreatePayload = z
      .object({
        title: z.string().trim().min(1).max(200),
        description: z.string().max(20_000).nullable().optional(),
        assigneeUserId: z.number().int().positive().nullable().optional(),
        dueAt: z.iso.datetime().nullable().optional(),
        priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
        channelId: z.string().uuid().nullable().optional(),
        recurrence: z.unknown().nullable().optional(),
      });

const schema = (value: z.ZodType) => z.toJSONSchema(value, { unrepresentable: "any", io: "input" });
export const assistantPayloadSchemas: Record<string, Record<string, unknown>> = {
  manage_work_hub_crew: schema(crewNamePayload), manage_work_hub_crew_member: schema(crewMemberPayload), manage_work_hub_channel: schema(channelCreatePayload.partial()),
  manage_work_hub_form_template: { anyOf: [schema(templatePayload), schema(templateAssignmentPayload)] },
  manage_work_hub_checklist_template: { anyOf: [schema(templatePayload), schema(templateAssignmentPayload)] },
  respond_work_hub_form: schema(formResponsePayload), respond_work_hub_checklist: schema(checklistResponsePayload),
  manage_work_hub_approval: { anyOf: [schema(approvalRequestPayload), schema(approvalDecisionPayload)] },
};

Object.assign(assistantPayloadSchemas, { manage_work_hub_shift: schema(shiftCreatePayload.partial()), manage_work_hub_meeting: schema(meetingCreatePayload.partial().extend({ expectedVersion: z.number().int().nonnegative().optional(), invited: z.boolean().optional() })), manage_work_hub_calendar_item: { anyOf: [schema(shiftCreatePayload.partial()), schema(meetingCreatePayload.partial()), schema(taskCreatePayload.partial())] } });
