import type { ComponentType } from "react";

export type NavIcon = ComponentType<{ className?: string }>;

export type NavItem = {
  href: string;
  label: string;
  key: string;
  icon?: NavIcon;
};

export type GateLogViewer = {
  role: string;
  vendorRole?: string | null;
};

export function canViewGateLog(user: GateLogViewer | null | undefined): boolean {
  if (!user) return false;
  if (user.role === "admin" || user.role === "partner") return true;
  if (user.role !== "vendor") return false;
  const role = user.vendorRole;
  return role == null || role === "office" || role === "both";
}

export function gateLogNavAnchorKey(items: Array<Pick<NavItem, "key">>): string {
  if (items.some((item) => item.key === "crew-map")) return "crew-map";
  if (items.some((item) => item.key === "site-map")) return "site-map";
  return "tracking";
}

export function withGateLogNav(
  items: NavItem[],
  opts: {
    user: GateLogViewer | null | undefined;
    gatekeepingEnabled: boolean;
    label: string;
    icon?: NavIcon;
  },
): NavItem[] {
  if (!canViewGateLog(opts.user)) return items;
  items = items.filter((item) => item.key !== "visitors" && item.key !== "gate-log");
  const item: NavItem = {
    href: "/gate-log",
    label: opts.label,
    key: "gate-log",
    icon: opts.icon,
  };
  const afterKey = gateLogNavAnchorKey(items);
  const idx = items.findIndex((row) => row.key === afterKey);
  if (idx === -1) return [...items, item];
  return [...items.slice(0, idx + 1), item, ...items.slice(idx + 1)];
}
