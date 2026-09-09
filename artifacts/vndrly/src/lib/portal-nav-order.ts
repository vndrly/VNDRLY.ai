/** Reorders only existing links; permissions and destinations remain with the caller. */
export function orderPortalNavigation<T extends { key: string }>(items: T[], role?: string): T[] {
  if (!items.some((item) => item.key === "dashboard")) return items;
  const priority = ["dashboard", "analytics", "work-hub", ...(role === "vendor" ? ["vendors", "partners"] : role === "partner" ? ["partners", "vendors"] : [])];
  return [...priority.flatMap((key) => items.filter((item) => item.key === key)), ...items.filter((item) => !priority.includes(item.key))];
}
