export type MobileTenant = {
  vendorId?: number | null;
  partnerId?: number | null;
};
export function mobileOwner(user: MobileTenant | null | undefined) {
  if (user?.partnerId) return { type: "partner" as const, id: user.partnerId };
  if (user?.vendorId) return { type: "vendor" as const, id: user.vendorId };
  return null;
}
export function moduleEndpoint(module: string, query = "") {
  if (module === "files-notes") return "/api/work-hub/files";
  if (module === "tasks-forms") return "/api/work-hub/tasks";
  if (module === "settings-connections")
    return "/api/work-hub/connectors/microsoft-365";
  if (module === "search")
    return `/api/work-hub/search?q=${encodeURIComponent(query)}`;
  if (module === "calendar" || module === "meetings") {
    const start = new Date();
    const end = new Date(start);
    end.setMonth(end.getMonth() + 3);
    return `/api/work-hub/calendar?start=${start.toISOString()}&end=${end.toISOString()}`;
  }
  return "/api/work-hub/channels";
}
