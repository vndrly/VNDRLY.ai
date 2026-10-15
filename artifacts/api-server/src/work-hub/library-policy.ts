import { LibraryFieldSchema, type LibraryMetadata } from "@workspace/api-zod";
export function assignmentDeadline(
  kind: string,
  hours: number,
  pollClose: string | null,
  now: Date,
) {
  if (kind === "poll") {
    if (!pollClose || Date.parse(pollClose) <= now.getTime())
      throw Error("Poll is closed");
    return new Date(pollClose);
  }
  return new Date(now.getTime() + hours * 3600000);
}
export function publicTraining<
  T extends { questions: { correctOptionIds: string[] }[] },
>(training: T) {
  return {
    ...training,
    questions: training.questions.map(
      ({ correctOptionIds: _, ...question }) => question,
    ),
  };
}
export function validateLibraryValues(
  definition: unknown[],
  values: Record<string, unknown>,
) {
  const fields = definition.map((f) => LibraryFieldSchema.parse(f));
  if (Object.keys(values).some((k) => !fields.some((f) => f.id === k)))
    throw Error("Unknown form field");
  const result: Record<string, unknown> = {};
  for (const f of fields) {
    const value = values[f.id],
      empty = value === undefined || value === null || value === "";
    if (f.required && (empty || (f.type === "checkbox" && value !== true)))
      throw Error(`${f.label} is required`);
    if (empty) continue;
    const valid =
      f.type === "checkbox"
        ? typeof value === "boolean"
        : f.type === "number"
          ? typeof value === "number" && Number.isFinite(value)
          : f.type === "choice"
            ? typeof value === "string" && f.options.some((x) => x.id === value)
            : f.type === "date"
              ? typeof value === "string" &&
                /^\d{4}-\d{2}-\d{2}$/.test(value) &&
                !Number.isNaN(Date.parse(value)) &&
                new Date(value).toISOString().slice(0, 10) === value
              : typeof value === "string" && value.length <= 20000;
    if (!valid) throw Error(`${f.label} has an invalid value`);
    result[f.id] = value;
  }
  return result;
}

export function safeLibraryContent(metadata: LibraryMetadata, manage: boolean) {
  const { fileSnapshots: _, ...safe } = metadata;
  return {
    ...safe,
    content: safe.content && {
      ...safe.content,
      training: safe.content.training
        ? manage
          ? safe.content.training
          : publicTraining(safe.content.training)
        : null,
    },
  };
}
export function shouldReuseLibraryAssignment(
  status: string,
  renew: boolean,
  kind: string,
) {
  return (
    kind === "poll" ||
    !renew ||
    status === "assigned" ||
    status === "in_progress"
  );
}
