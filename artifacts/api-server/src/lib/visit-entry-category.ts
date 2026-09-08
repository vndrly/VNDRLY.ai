export const VISIT_ENTRY_CATEGORIES = ["visitor", "routine_vendor_work", "partner_admin", "vendor_admin"] as const;
export type VisitEntryCategory = typeof VISIT_ENTRY_CATEGORIES[number];
export function parseVisitEntryCategory(value: unknown): VisitEntryCategory | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !VISIT_ENTRY_CATEGORIES.includes(value as VisitEntryCategory)) throw new Error("Invalid entry category");
  return value as VisitEntryCategory;
}
