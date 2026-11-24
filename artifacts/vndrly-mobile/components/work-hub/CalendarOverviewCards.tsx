import React, { useState } from "react";
import { View, Text, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { useUnifiedWorkCalendar } from "@/lib/use-unified-work-calendar";
import { WorkspacePanel, WorkspaceRow } from "./WorkspacePanel";

type Shift = { id: string; title: string; date: string; startsAt: string; endsAt: string; required: number; assignees: number[] };
type Facts = {
  workers: { userId: number; state: string }[];
  unavailable: { userId: number; startsAt: string; endsAt: string }[];
  requests: { shiftId: string; userId: number; status?: string }[];
  awaitingAcknowledgment?: { shiftId: string; userId: number }[];
  urgentShiftIds: string[];
  incidents?: { shiftId: string; userId?: number }[];
};
type Gap = { id: string; title: string; date: string };
const categories = ["Urgent gaps", "New / Unassigned Recurring Shifts", "Needs temporary coverage", "Shift requested off", "Awaiting acknowledgment"] as const;
type Category = typeof categories[number];
const emptyCoverage = (): Record<Category, Gap[]> => ({ "Urgent gaps": [], "New / Unassigned Recurring Shifts": [], "Needs temporary coverage": [], "Shift requested off": [], "Awaiting acknowledgment": [] });

function coverageForSite(site: { id: number; name: string }, shifts: Shift[], facts: Facts, now: number) {
  const result = emptyCoverage();
  if (!shifts.length) result["New / Unassigned Recurring Shifts"].push({ id: `site:${site.id}`, title: site.name, date: "" });
  for (const shift of shifts) {
    if (Date.parse(shift.endsAt) <= now) continue;
    const label = `${site.name} · ${shift.title}`;
    const entry = { id: shift.id, title: label, date: shift.date };
    const affected = new Set<number>();
    let uncovered = false;
    for (const request of facts.requests.filter(row => row.shiftId === shift.id && shift.assignees.includes(row.userId))) {
      affected.add(request.userId);
      result["Shift requested off"].push(entry);
      if (request.status === "approved") uncovered = true;
    }
    for (const pending of facts.awaitingAcknowledgment ?? []) {
      if (pending.shiftId === shift.id && shift.assignees.includes(pending.userId) && !affected.has(pending.userId)) {
        affected.add(pending.userId);
        result["Awaiting acknowledgment"].push(entry);
      }
    }
    for (const userId of shift.assignees) {
      if (affected.has(userId)) continue;
      const state = facts.workers.find(worker => worker.userId === userId)?.state;
      const unavailable = facts.unavailable.some(row => row.userId === userId && row.startsAt < shift.endsAt && row.endsAt > shift.startsAt);
      if (state === "inactive") { result["New / Unassigned Recurring Shifts"].push(entry); uncovered = true; }
      else if (state === "hold" || unavailable) { result["Needs temporary coverage"].push(entry); uncovered = true; }
    }
    if (shift.required > shift.assignees.length) { result["New / Unassigned Recurring Shifts"].push(entry); uncovered = true; }
    const incident = facts.incidents?.some(row => row.shiftId === shift.id) || facts.urgentShiftIds.includes(shift.id);
    if (incident || uncovered && Date.parse(shift.startsAt) <= now + 86_400_000) result["Urgent gaps"].push(entry);
  }
  return result;
}

function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
const open = (path: string) => router.push(path as never);

export default function CalendarOverviewCards() {
  const { user, activeMembershipId } = useAuth();
  const { primary } = useColors();
  const { width } = useWindowDimensions();
  const [range] = useState(() => ({ start: new Date(Date.now() - 86_400_000).toISOString(), end: new Date(Date.now() + 31 * 86_400_000).toISOString() }));
  const [coverageRange] = useState(() => { const from = new Date(); const through = new Date(); through.setDate(through.getDate() + 6); return { from: dateKey(from), through: dateKey(through) }; });
  const [openCategory, setOpenCategory] = useState<Category | null>(null);
  const identity = [user?.id, activeMembershipId, user?.vendorId, user?.partnerId];
  const calendar = useUnifiedWorkCalendar(range);
  const home = useQuery({ queryKey: ["work-hub", "home", ...identity], queryFn: () => apiFetch<{ tasks?: { id: string; title: string; status: string; dueAt?: string }[] }>("/api/work-hub/home"), enabled: !!user, refetchInterval: 15000 });
  const channels = useQuery({ queryKey: ["work-hub", "channels", ...identity], queryFn: () => apiFetch<{ unreadCount?: number }[]>("/api/work-hub/channels"), enabled: !!user, refetchInterval: 15000 });
  const admin = user?.role === "admin" || user?.availableMemberships?.some(membership => membership.id === activeMembershipId && membership.role === "admin");
  const coverage = useQuery({
    queryKey: ["work-hub", "calendar-coverage", ...identity, coverageRange.from],
    enabled: !!user?.vendorId && !!admin,
    retry: false,
    refetchInterval: 30000,
    queryFn: async () => {
      const base = `/api/work-hub/site-shift-plans`;
      const scope = `type=vendor&id=${user!.vendorId}`;
      const { sites } = await apiFetch<{ sites: { id: number; name: string }[] }>(`${base}?${scope}`);
      const facts = await apiFetch<Facts>(`${base}/coverage-facts?${scope}&from=${coverageRange.from}&through=${coverageRange.through}`);
      const schedules = await Promise.all(sites.map(async site => ({ site, schedule: await apiFetch<{ shifts: Shift[] }>(`${base}/${site.id}/schedule?${scope}&from=${coverageRange.from}&through=${coverageRange.through}`) })));
      const result = emptyCoverage();
      for (const { site, schedule } of schedules) {
        const group = coverageForSite(site, schedule.shifts, facts, Date.now());
        for (const category of categories) result[category].push(...group[category]);
      }
      return result;
    },
  });
  const now = Date.now();
  const items = calendar.data?.items ?? [];
  const next = (kind: "shift" | "meeting") => items.filter(item => item.kind === kind && Date.parse(item.endsAt ?? item.startsAt) >= now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const shift = next("shift"), meeting = next("meeting");
  const dueTasks = home.data?.tasks?.filter(row => !["completed", "cancelled", "archived"].includes(row.status) && row.dueAt && Date.parse(row.dueAt) <= now + 7 * 86_400_000).sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
  const task = dueTasks?.[0];
  const unread = channels.data?.reduce((sum, row) => sum + (row.unreadCount ?? 0), 0);
  const unavailable = "Unavailable";
  const summary = [
    { key: "shift", icon: "users" as const, label: "My next shift", detail: shift ? `${shift.title} · ${new Date(shift.startsAt).toLocaleString()}` : "No upcoming shifts", value: calendar.isError ? unavailable : calendar.data ? String(items.filter(item => item.kind === "shift" && Date.parse(item.endsAt ?? item.startsAt) >= now).length) : "…", path: "/work-hub/calendar" },
    { key: "meeting", icon: "calendar" as const, label: "Next meeting", detail: meeting ? `${meeting.title} · ${new Date(meeting.startsAt).toLocaleString()}` : "No upcoming meetings", value: calendar.isError ? unavailable : calendar.data ? String(items.filter(item => item.kind === "meeting" && Date.parse(item.endsAt ?? item.startsAt) >= now).length) : "…", path: "/work-hub/chat?view=meetings" },
    { key: "task", icon: "check-square" as const, label: "Tasks due soon", detail: task?.dueAt ? `${task.title} · ${new Date(task.dueAt).toLocaleString()}` : "No tasks due soon", value: home.isError ? unavailable : dueTasks ? String(dueTasks.length) : "…", path: "/work-hub/managed-crews" },
    { key: "messages", icon: "message-square" as const, label: "Unread conversations", value: channels.isError ? unavailable : String(unread ?? "…"), path: "/work-hub/chat" },
  ];
  return <View style={{ flexDirection: width >= 740 ? "row" : "column", alignItems: "flex-start", gap: 12 }}>
    <View style={{ flex: width >= 740 ? 1 : undefined, width: width >= 740 ? undefined : "100%" }}>
      <WorkspacePanel title="At a glance" subtitle="Shifts, meetings, tasks, and conversations" icon="calendar">
        {summary.map(row => <WorkspaceRow key={row.key} icon={row.icon} label={row.label} detail={row.detail} value={row.value} topAligned onPress={() => open(row.path)} />)}
      </WorkspacePanel>
    </View>
    {admin && user?.vendorId ? <View style={{ flex: width >= 740 ? 1 : undefined, width: width >= 740 ? undefined : "100%" }}>
      <WorkspacePanel title="Coverage Gaps" subtitle="Unfilled shifts and coverage requests across all sites" icon="alert-triangle">
        <Text style={{ color: "#ececec", fontSize: 12, paddingBottom: 8 }}>Next 7 Days</Text>
        {categories.map(category => <React.Fragment key={category}>
          <WorkspaceRow icon="calendar" label={category} value={coverage.isError ? "—" : coverage.data ? String(coverage.data[category].length) : "…"} expanded={openCategory === category} onPress={() => setOpenCategory(value => value === category ? null : category)} />
          {openCategory === category && <View style={{ paddingLeft: 28, paddingBottom: 8 }}>
            {coverage.data?.[category].length ? coverage.data[category].map((gap, index) => <Text key={`${gap.id}:${index}`} onPress={() => open(gap.date ? `/work-hub/calendar?day=${gap.date}` : "/work-hub/calendar")} style={{ color: primary, paddingVertical: 6 }}>{gap.title}</Text>) : <Text style={{ color: "#b3b3b3", paddingVertical: 6 }}>{coverage.isError ? "Coverage is unavailable." : "No gaps in this category."}</Text>}
          </View>}
        </React.Fragment>)}
      </WorkspacePanel>
    </View> : null}
  </View>;
}
