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
  if (module === "payroll-documents")
    return "/api/work-hub/finance/personal-documents";
  if (module === "calls") return "/api/work-hub/calls";
  if (module === "activity") return "/api/work-hub/activity";
  if (module === "chat") return "/api/work-hub/chats";
  if (module === "crews") return "/api/work-hub/crews";
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

/** Mobile intentionally omits payroll processing, refunds and bulk migration. */
export function mobileWorkHubModules(isTablet: boolean, companyAdmin: boolean) {
  const items = [
    {
      key: "payroll-documents",
      label: "My payroll documents",
      icon: "file-text",
    },
    { key: "activity", label: "Activity", icon: "bell" },
    { key: "chat", label: "Chat", icon: "message-circle" },
    { key: "channels", label: "Crews & Channels", icon: "users" },
    { key: "calendar", label: "Calendar", icon: "calendar" },
    { key: "files-notes", label: "Files & Notes", icon: "folder" },
    { key: "tasks-forms", label: "Tasks & Forms", icon: "check-square" },
    { key: "calls", label: "Calls", icon: "phone" },
    { key: "meetings", label: "Meetings", icon: "headphones" },
    { key: "askv", label: "AskV", icon: "mic" },
    { key: "search", label: "Search", icon: "search" },
  ];
  if (isTablet && companyAdmin)
    items.push({ key: "crews", label: "Manage Crews", icon: "users" });
  return items;
}
