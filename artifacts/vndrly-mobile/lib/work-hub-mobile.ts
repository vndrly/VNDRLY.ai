export type MobileTenant = {
  vendorId?: number | null;
  partnerId?: number | null;
};
export type MobileWorkHubCapabilities = {
  canUploadFile: boolean;
  canCreateNote: boolean;
  canEditNote: boolean;
  canCreateAsset: boolean;
  canManageAsset: boolean;
  canCheckOutAsset: boolean;
  canVerifyIssuedAsset: boolean;
  canViewExports: boolean;
  allowedExportDatasets: readonly string[];
  canManageGateLocations: boolean;
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
  if (module === "managed-crews") return "/api/implementation-a/sponsorships";
  if (module === "inventory") return "/api/implementation-a/assets";
  if (module === "site-presence") return "/api/site-map/overview";
  if (module === "operations-health") return "/api/implementation-a/operations-health";
  if (module === "chat") return "/api/work-hub/chats";
  if (module === "crews") return "/api/work-hub/crews";
  if (module === "files-notes") return "/api/work-hub/files";
  if (module === "tasks-forms") return "/api/work-hub/tasks";
  if (module === "settings-connections")
    return "/api/work-hub/connectors/microsoft-365";
  if (module === "search")
    return `/api/work-hub/search?q=${encodeURIComponent(query)}`;
  if (module === "calendar" || module === "meetings" || module === "workforce-coverage") {
    const start = new Date();
    const end = new Date(start);
    end.setMonth(end.getMonth() + 3);
    return `/api/work-hub/calendar?start=${start.toISOString()}&end=${end.toISOString()}`;
  }
  if (module === "channels") return "/api/work-hub/crews";
  return "/api/work-hub/channels";
}

/** Load every authorized channel before collecting notes; channel lists are paged at 100. */
export async function loadFilesInventoryData(
  owner: { type: "vendor" | "partner"; id: number },
  fetchJson: (path: string) => Promise<any>,
) {
  const [files, rawAssets, home] = await Promise.all([
    fetchJson(`/api/work-hub/file-library?orgType=${owner.type}&orgId=${owner.id}`),
    fetchJson("/api/implementation-a/assets"),
    fetchJson("/api/work-hub/home"),
  ]);
  const channels: Array<{ id: string; name: string; updatedAt: string }> = [];
  let before: { id: string; updatedAt: string } | null = null;
  while (true) {
    const cursor = before ? `&before=${encodeURIComponent(before.updatedAt)}&beforeId=${encodeURIComponent(before.id)}` : "";
    const page = await fetchJson(`/api/work-hub/channels?limit=100${cursor}`) as typeof channels;
    channels.push(...page);
    if (page.length < 100) break;
    const last = page[page.length - 1]!;
    if (before?.id === last.id) throw new Error("Channel pagination did not advance.");
    before = last;
  }
  const notes: unknown[] = [];
  for (let index = 0; index < channels.length; index += 10) {
    const batch = channels.slice(index, index + 10);
    notes.push(...(await Promise.all(batch.map(channel => fetchJson(`/api/work-hub/channels/${encodeURIComponent(channel.id)}/notes`)))).flat());
  }
  return { files, assets: Array.isArray(rawAssets) ? rawAssets : rawAssets?.assets ?? [], channels, notes, capabilities: home.capabilities };
}

/** Mobile intentionally omits payroll processing, refunds and bulk migration. */
export function mobileWorkHubModules(
  isTablet: boolean,
  companyAdmin: boolean,
  companyName?: string | null,
  capabilities?: Pick<MobileWorkHubCapabilities, "canViewExports" | "allowedExportDatasets"> | null,
  filesInventoryLabel = "Files & Inventory",
) {
  const items = [
    {
      key: "payroll-documents",
      label: "My payroll documents",
      icon: "file-text",
    },
    { key: "activity", label: "Activity", icon: "bell" },
    { key: "chat", label: `${companyName?.trim() || "Company"} Chat`, icon: "message-circle" },
    { key: "channels", label: "Groups", icon: "users" },
    { key: "calendar", label: "Calendar", icon: "calendar" },
    { key: "managed-crews", label: "Managed Crews", icon: "users" },
    { key: "workforce-coverage", label: "Workforce Coverage", icon: "clock" },
    { key: "site-presence", label: "Site Presence", icon: "map-pin" },
    { key: "safety-response", label: "Safety Response", icon: "shield" },
    { key: "files-notes", label: filesInventoryLabel, icon: "folder" },
    { key: "tasks-forms", label: "Tasks & Forms", icon: "check-square" },
    { key: "calls", label: "Calls", icon: "phone" },
    { key: "meetings", label: "Meetings", icon: "headphones" },
    { key: "askv", label: "AskV", icon: "mic" },
    { key: "search", label: "Search", icon: "search" },
  ];
  if (capabilities?.canViewExports && capabilities.allowedExportDatasets.length > 0)
    items.push({ key: "implementation-exports", label: "Exports", icon: "download" });
  if (companyAdmin) items.push({ key: "operations-health", label: "Operations Health", icon: "activity" });
  if (isTablet && companyAdmin)
    items.push({ key: "crews", label: "Manage Crews", icon: "users" });
  return items;
}
