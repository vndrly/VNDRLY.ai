type Config = {
  kind: string;
  durationHours?: number;
  choices?: { id: string; label: string }[];
  maxSelections?: number;
  resultsTiming?: string;
};
type State = { status: string; deadline?: string | null };
export function campaignDeadline(config: Config, publishedAt: Date): Date {
  return new Date(
    publishedAt.getTime() +
      (config.durationHours ?? (config.kind === "poll" ? 24 : 720)) * 3600000,
  );
}
export function campaignCanSubmit(
  config: Config,
  state: State,
  now: Date,
): boolean {
  if (!["published", "closed"].includes(state.status) || !state.deadline)
    return false;
  return (
    config.kind !== "poll" ||
    (state.status === "published" && now.getTime() < Date.parse(state.deadline))
  );
}
export function validateCampaignResponse(
  config: Config,
  values: Record<string, unknown>,
): Record<string, unknown> {
  if (config.kind === "acknowledgement") {
    if (values.acknowledged !== true)
      throw Error("Explicit acknowledgement is required");
    return { acknowledged: true };
  }
  if (config.kind === "poll") {
    const selected = values.choices;
    if (
      !Array.isArray(selected) ||
      selected.length < 1 ||
      selected.length > (config.maxSelections ?? 1) ||
      new Set(selected).size !== selected.length ||
      selected.some(
        (id) =>
          typeof id !== "string" || !config.choices?.some((c) => c.id === id),
      )
    )
      throw Error("Choose only the allowed poll choices");
    return { choices: selected };
  }
  if (
    !values.values ||
    typeof values.values !== "object" ||
    Array.isArray(values.values)
  )
    throw Error("Form values required");
  return values.values as Record<string, unknown>;
}
export function campaignResultsVisible(
  config: Pick<Config, "resultsTiming">,
  state: State,
  now: Date,
): boolean {
  return (
    config.resultsTiming === "live" ||
    state.status === "closed" ||
    (!!state.deadline && now.getTime() >= Date.parse(state.deadline))
  );
}

export function requireCampaignPublicationContent(config: {
  kind: string;
  question?: string;
  policyText?: string;
  policyAttachmentId?: string | null;
}) {
  if (config.kind === "poll" && !config.question?.trim())
    throw Error("A poll question is required before publication");
  if (
    config.kind === "acknowledgement" &&
    !config.policyText?.trim() &&
    !config.policyAttachmentId
  )
    throw Error(
      "Actual policy text or an authorized policy attachment is required before publication",
    );
}

export type GeneralCampaignField = {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "checkbox";
  required?: boolean;
};
export function generalCampaignFields(
  definition: unknown[],
): GeneralCampaignField[] {
  const fields = definition as GeneralCampaignField[];
  if (
    !fields.length ||
    fields.length > 100 ||
    fields.some(
      (f) =>
        !f ||
        typeof f.id !== "string" ||
        !f.id ||
        typeof f.label !== "string" ||
        !["text", "textarea", "number", "checkbox"].includes(f.type),
    ) ||
    new Set(fields.map((f) => f.id)).size !== fields.length
  )
    throw Error("Source form contains unsupported fields");
  return fields;
}
export function validateGeneralCampaignValues(
  definition: unknown[],
  values: Record<string, unknown>,
) {
  const fields = generalCampaignFields(definition);
  if (Object.keys(values).some((k) => !fields.some((f) => f.id === k)))
    throw Error("Unknown form field");
  const result: Record<string, unknown> = {};
  for (const f of fields) {
    const value = values[f.id];
    const empty = value === undefined || value === null || value === "";
    if (f.required && (empty || (f.type === "checkbox" && value !== true)))
      throw Error(`${f.label} is required`);
    if (empty) continue;
    if (
      f.type === "checkbox"
        ? typeof value !== "boolean"
        : f.type === "number"
          ? typeof value !== "number" || !Number.isFinite(value)
          : typeof value !== "string" || value.length > 20000
    )
      throw Error(`${f.label} has an invalid value`);
    result[f.id] = value;
  }
  return result;
}
