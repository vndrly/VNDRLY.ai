import { and, eq, desc } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod/v4";
import {
  db,
  workHubFormInstancesTable as instances,
  workHubFormSubmissionsTable as submissions,
} from "@workspace/db";
import {
  type WorkHubCommandEnvelope,
  AssignmentMetadataSchema,
} from "@workspace/api-zod";
import {
  libraryCommand,
  libraryAuthority,
  libraryRecord,
  LibraryError,
  type LibraryActor,
} from "./library-core";
import { readAssignedLibrary } from "./library-assignments";
import { safeLibraryContent } from "./library-service";
import {
  gradeTraining,
  trainingCompletionReady,
  validateTrainingProgress,
} from "./training-policy";
import { validateLibraryValues } from "./library-policy";
import { validateCampaignResponse } from "./form-campaign-policy";
import { getObjectStore } from "../lib/objectStore";
const response = z.object({
  acknowledged: z.boolean().default(false),
  lessonIds: z.array(z.string()).max(50).default([]),
  answers: z.record(z.string(), z.array(z.string()).max(20)).default({}),
  values: z.record(z.string(), z.unknown()).default({}),
  choices: z.array(z.string()).max(20).default([]),
});
export async function getAssignedLibrary(actor: LibraryActor, id: string) {
  const own = await readAssignedLibrary(db, actor, id),
    history = await db
      .select({
        id: submissions.id,
        version: submissions.version,
        values: submissions.values,
        submittedAt: submissions.submittedAt,
      })
      .from(submissions)
      .where(eq(submissions.instanceId, id))
      .orderBy(desc(submissions.version))
      .limit(100);
  return {
    instanceId: id,
    title: own.record.name,
    metadata: safeLibraryContent(own.metadata, false),
    assignment: own.assignment,
    version: own.assignment.version,
    history,
    attachments: Object.entries(own.metadata.fileSnapshots).map(
      ([fileId, { storageKey: _, checksumSha256: __, ...f }]) => ({
        fileId,
        ...f,
      }),
    ),
    canSubmit:
      (!["completed", "cancelled", "exempted"].includes(
        own.assignment.status,
      ) ||
        (own.metadata.kind === "poll" &&
          own.metadata.content?.poll?.allowChanges &&
          own.assignment.status === "completed")) &&
      (own.metadata.kind !== "poll" ||
        (!!own.metadata.pollClosesAt &&
          Date.now() < Date.parse(own.metadata.pollClosesAt))),
  };
}
export async function submitAssignedLibrary(
  actor: LibraryActor,
  id: string,
  e: WorkHubCommandEnvelope,
  mode: "progress" | "attempt" | "complete",
) {
  const payload = response.parse(e.payload);
  return libraryCommand(
    actor,
    e,
    `library.${mode}`,
    id,
    async (tx) => {
      const own = await readAssignedLibrary(tx, actor, id, true),
        a = own.assignment,
        m = own.metadata,
        now = new Date();
      if (e.expectedVersion !== a.version)
        throw new LibraryError("Assignment changed; refresh", 409);
      if (
        ["completed", "cancelled", "exempted"].includes(a.status) &&
        !(
          m.kind === "poll" &&
          m.content?.poll?.allowChanges &&
          a.status === "completed"
        )
      )
        throw new LibraryError("Assignment is not accepting responses", 409);
      let saved: Record<string, unknown> = {},
        passed = true;
      const history = await tx
        .select()
        .from(submissions)
        .where(eq(submissions.instanceId, id))
        .orderBy(desc(submissions.version))
        .limit(100);
      if (m.kind === "training") {
        const training = m.content!.training!;
        if (
          payload.lessonIds.some(
            (id) => !training.lessons.some((l) => l.id === id),
          ) ||
          Object.keys(payload.answers).some(
            (id) => !training.questions.some((q) => q.id === id),
          )
        )
          throw new LibraryError("Unknown training content", 400);
        try {
          validateTrainingProgress(training, payload.answers);
        } catch {
          throw new LibraryError("Choose permitted quiz answers", 400);
        }
        a.progress = {
          lessonIds: [...new Set(payload.lessonIds)],
          answers: payload.answers,
        };
        a.status = "in_progress";
        if (mode === "progress") {
          a.version++;
          await tx
            .update(instances)
            .set({ assignmentMetadata: a })
            .where(eq(instances.id, id));
          return {
            instanceId: id,
            version: a.version,
            status: a.status,
            progressSaved: true,
          };
        }
        const attempts = history.filter(
          (h) =>
            h.values.type === "quiz" &&
            (!a.attemptResetAt ||
              h.submittedAt.getTime() > Date.parse(a.attemptResetAt)),
        );
        if (training.completionMode !== "checkoff") {
          if (mode !== "attempt")
            throw new LibraryError("Submit the required quiz", 400);
          if (
            attempts.length >=
            (training.allowRetries ? training.maximumAttempts : 1)
          )
            throw new LibraryError(
              "Quiz attempt limit reached; ask your administrator",
              409,
            );
          let grade: ReturnType<typeof gradeTraining>;
          try {
            grade = gradeTraining(training, payload.answers);
          } catch {
            throw new LibraryError(
              "Answer every quiz question with permitted choices",
              400,
            );
          }
          passed = grade.passed;
          saved = {
            type: "quiz",
            answers: payload.answers,
            acknowledged: payload.acknowledged,
            lessonIds: a.progress.lessonIds,
            grade,
            attempt: attempts.length + 1,
          };
        } else
          saved = {
            type: "training_checkoff",
            acknowledged: payload.acknowledged,
            lessonIds: a.progress.lessonIds,
          };
        const complete = trainingCompletionReady(
          training,
          a.progress.lessonIds,
          payload.acknowledged,
          passed,
        );
        if (
          training.completionMode !== "quiz" &&
          (!payload.acknowledged ||
            !training.lessons.every((l) => a.progress.lessonIds.includes(l.id)))
        )
          throw new LibraryError(
            "Complete and acknowledge all required lessons",
            400,
          );
        a.status = complete ? "completed" : "in_progress";
        if (complete && training.refresherDays)
          a.refresherDueAt = new Date(
            now.getTime() + training.refresherDays * 86400000,
          ).toISOString();
      } else if (mode === "progress")
        throw new LibraryError("Progress saving applies to training", 400);
      else if (m.kind === "policy") {
        if (payload.acknowledged !== true)
          throw new LibraryError(
            "Explicit policy acknowledgement required",
            400,
          );
        saved = { acknowledged: true, policyVersion: m.contentVersion };
        a.status = "completed";
      } else if (m.kind === "form") {
        try {
          saved = validateLibraryValues(m.content!.fields, payload.values);
        } catch (e) {
          throw new LibraryError(
            e instanceof Error ? e.message : "Invalid form response",
            400,
          );
        }
        a.status = "completed";
      } else if (m.kind === "poll") {
        if (!m.pollClosesAt || now.getTime() >= Date.parse(m.pollClosesAt))
          throw new LibraryError("Poll is closed", 409);
        const poll = m.content!.poll!;
        if (history.length && !poll.allowChanges)
          throw new LibraryError("Vote changes are disabled", 409);
        saved = validateCampaignResponse(
          {
            kind: "poll",
            choices: poll.choices,
            maxSelections: poll.maxSelections,
          },
          { choices: payload.choices },
        );
        a.status = "completed";
      } else throw new LibraryError("Content cannot be submitted", 400);
      const [submission] = await tx
        .insert(submissions)
        .values({
          instanceId: id,
          version: (history[0]?.version ?? 0) + 1,
          priorSubmissionId: history[0]?.id ?? null,
          submittedById: actor.userId,
          values: saved,
          submittedAt: now,
        })
        .returning({ id: submissions.id, version: submissions.version });
      a.version++;
      await tx
        .update(instances)
        .set({ assignmentMetadata: a })
        .where(eq(instances.id, id));
      return {
        instanceId: id,
        submissionId: submission.id,
        version: a.version,
        contentVersion: a.contentVersion,
        status: a.status,
        submittedAt: now.toISOString(),
        late: now.getTime() >= Date.parse(a.dueAt),
        ...("grade" in saved ? { grade: saved.grade } : {}),
      };
    },
    false,
  );
}
export async function resetTrainingAttempts(
  actor: LibraryActor,
  id: string,
  e: WorkHubCommandEnvelope,
) {
  const reason = String((e.payload as { reason?: string }).reason ?? "").trim();
  if (!reason) throw new LibraryError("Reset reason required", 400);
  return libraryCommand(actor, e, "library.training-reset", id, async (tx) => {
    const { owner } = await libraryAuthority(tx, actor, true, true);
    const [candidate] = await tx
      .select()
      .from(instances)
      .where(eq(instances.id, id))
      .limit(1);
    if (!candidate?.assignmentMetadata)
      throw new LibraryError("Assignment not found", 404);
    const item = await libraryRecord(
      tx,
      actor,
      candidate.templateId,
      true,
      true,
    );
    if (item.metadata.kind !== "training")
      throw new LibraryError("Training assignment required", 400);
    const [instance] = await tx
      .select()
      .from(instances)
      .where(
        and(
          eq(instances.id, id),
          eq(instances.templateId, candidate.templateId),
        ),
      )
      .limit(1)
      .for("update");
    if (!instance?.assignmentMetadata)
      throw new LibraryError("Assignment changed; refresh", 409);
    const a = AssignmentMetadataSchema.parse(instance.assignmentMetadata);
    if (a.status !== "in_progress" || e.expectedVersion !== a.version)
      throw new LibraryError("Training progress changed", 409);
    a.attemptResetAt = new Date().toISOString();
    a.version++;
    a.reason = reason;
    await tx
      .update(instances)
      .set({ assignmentMetadata: a })
      .where(eq(instances.id, id));
    return { instanceId: id, version: a.version, resetAt: a.attemptResetAt };
  });
}
export async function assignedLibraryFile(
  actor: LibraryActor,
  id: string,
  fileId: string,
) {
  const own = await readAssignedLibrary(db, actor, id),
    file = own.metadata.fileSnapshots[fileId];
  if (!file) throw new LibraryError("Assigned attachment not found", 404);
  const object = await getObjectStore().getObject(file.storageKey);
  if (
    !object ||
    object.body.length !== file.byteSize ||
    createHash("sha256").update(object.body).digest("hex") !==
      file.checksumSha256
  )
    throw new LibraryError("Attachment integrity unavailable", 409);
  await readAssignedLibrary(db, actor, id);
  return {
    body: object.body,
    fileName: file.fileName,
    contentType: file.contentType,
    byteSize: file.byteSize,
  };
}
