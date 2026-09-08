export const MICROSOFT_IMPORT_CATEGORIES = [
  "calendar",
  "files_notes",
  "conversations",
  "tasks_forms",
  "meetings",
] as const;
export type MicrosoftImportCategory =
  (typeof MICROSOFT_IMPORT_CATEGORIES)[number];
export type MicrosoftImportSelection = {
  category: MicrosoftImportCategory;
  externalId: string;
};

export function microsoftImportStatus(configured: boolean) {
  return {
    enabled: false,
    configured,
    mode: "staged_import",
    direction: "microsoft_to_vndrly",
    writeBack: false,
    authoritativeSourceAfterActivation: "vndrly",
    activationRequiresReview: true,
    categories: MICROSOFT_IMPORT_CATEGORIES,
    status: configured
      ? "awaiting_admin_connection"
      : "external_registration_required",
  } as const;
}

export function validateImportSelection(
  input: Array<{ category: string; externalId: string }>,
): MicrosoftImportSelection[] {
  const seen = new Set<string>();
  return input
    .map((item) => {
      if (
        !(MICROSOFT_IMPORT_CATEGORIES as readonly string[]).includes(
          item.category,
        )
      )
        throw new Error("Unsupported Microsoft import category");
      const externalId = item.externalId.trim();
      if (!externalId)
        throw new Error("Microsoft external identifier is required");
      return { category: item.category as MicrosoftImportCategory, externalId };
    })
    .filter((item) => {
      const key = `${item.category}:${item.externalId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
