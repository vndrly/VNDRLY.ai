import React, { useState } from "react";
import { Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { ModalPressable as Pressable, ModalTextInput as TextInput } from "@/components/ModalDraft";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";

type Task = { id: string; title: string; description?: string | null; status: string; ownerOrgId: number; assigneeUserId: number | null; assigneeName?: string | null; createdAt: string; version: number; siteName?: string; gateName?: string; completedByName?: string | null; gateHopper: { stationId: string; siteId: number; completedById?: number; completedAt?: string; completionNote?: string; clearedAt?: string } };
type Legacy = { id: string; stationId: string; text: string; createdAt: string; siteName: string; gateName: string };
type Options = { gates: { stationId: string; siteId: number; siteName: string; gateName: string; vendorId: number; vendorName: string }[]; people: { userId: number; name: string; vendorId: number }[]; canManage: boolean; canComplete: boolean };
type Page = { tasks: Task[]; unimported?: Legacy[]; total: number; nextBefore: string | null };
type Command = { operationId: string; actorUserId?: number; action: "create" | "import" | "complete" | "assign" | "clear" | "delete"; taskId?: string; expectedVersion?: number; text?: string; note?: string; stationId?: string; vendorId?: number; assigneeUserId?: number | null };

const muted = { color: "#b3b3b3", fontSize: 13 } as const;
const input = { color: "#ececec", backgroundColor: "#303034", borderColor: "#00b9d4", borderWidth: 1, borderRadius: 7, padding: 9, minHeight: 44 } as const;

export default function GateTaskHopperNative({ stationId, showTitle = false }: { stationId: string; showTitle?: boolean }) {
  const { user } = useAuth();
  const { primary } = useColors();
  const cache = useQueryClient();
  const [before, setBefore] = useState<string | null>(null);
  const [all, setAll] = useState<Task[]>([]);
  const [text, setText] = useState("");
  const [gate, setGate] = useState("");
  const [selectingGate, setSelectingGate] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [assignees, setAssignees] = useState<Record<string, number | null>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Command | null>(null);
  const eligible = Boolean(user && (user.role === "admin" || user.vendorId));
  const options = useQuery({ queryKey: ["gate-task-hopper-options", user?.id, stationId], queryFn: () => apiFetch<Options>("/api/work-hub/gate-task-hopper/options"), enabled: eligible, retry: false, refetchInterval: 15000 });
  const page = useQuery({ queryKey: ["gate-task-hopper", user?.id, stationId, before], queryFn: () => apiFetch<Page>(`/api/work-hub/gate-task-hopper?${new URLSearchParams({ stationId, ...(before ? { before } : {}) })}`), enabled: eligible, retry: false, refetchInterval: before ? false : 15000 });
  React.useEffect(() => { if (page.data) setAll(prior => before ? [...prior.filter(item => !page.data!.tasks.some(next => next.id === item.id)), ...page.data!.tasks] : page.data!.tasks); }, [page.data, before]);
  const gates = options.data?.gates.filter(item => item.stationId === stationId) ?? [];
  const selected = gates.find(item => `${item.vendorId}:${item.stationId}` === gate) ?? (gates.length === 1 ? gates[0] : undefined);
  const send = async (command: Command) => {
    if (busy) return;
    setPending(command); setBusy(true); setError("");
    try {
      await apiFetch("/api/work-hub/gate-task-hopper", { method: "POST", body: JSON.stringify(command) });
      setPending(null); setText(""); setBefore(null);
      await Promise.all([cache.invalidateQueries({ queryKey: ["gate-task-hopper"] }), cache.invalidateQueries({ queryKey: ["work-hub"] }), cache.invalidateQueries({ queryKey: ["change-over-state"] })]);
    } catch (caught) {
      if ((caught as { status?: number }).status && Number((caught as { status?: number }).status) < 500) setPending(null);
      setError(caught instanceof Error ? caught.message : "Task change could not be verified");
    } finally { setBusy(false); }
  };
  const act = (command: Omit<Command, "operationId" | "actorUserId">) => void send({ ...command, operationId: Crypto.randomUUID(), actorUserId: user?.id });
  const button = (label: string, onPress: () => void, disabled = false, retry = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled || busy || !!pending && !retry} onPress={onPress} style={{ alignSelf: "flex-start", borderWidth: 1, borderColor: primary, backgroundColor: "#29292c", borderRadius: 7, paddingHorizontal: 11, paddingVertical: 9, opacity: disabled || busy ? 0.5 : 1 }}><Text style={{ color: "#ececec", fontSize: 13, fontWeight: "600" }}>{label}</Text></Pressable>;
  if (!eligible) return null;
  return <View accessibilityLabel="Unassigned Task Hopper" style={{ gap: 10 }}>
    {showTitle && <Text style={{ color: "#ececec", fontSize: 14, fontWeight: "700" }}>Unassigned Task Hopper</Text>}
    {page.isPending && <Text style={muted}>Loading tasks…</Text>}
    {page.isError && <Text style={muted}>Task records could not load.</Text>}
    {all.map(task => <View key={task.id} style={{ borderTopWidth: 1, borderTopColor: "#414145", paddingTop: 7, gap: 7 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === task.id }} onPress={() => setExpanded(expanded === task.id ? null : task.id)}><Text style={{ color: "#ececec", fontSize: 13, fontWeight: "600" }}>{task.title} · {new Date(task.createdAt).toLocaleString()}</Text></Pressable>
      {expanded === task.id && <View style={{ paddingLeft: 18, gap: 8 }}>
        {!!task.description && <Text style={muted}>{task.description}</Text>}
        <Text style={muted}>{task.siteName} · {task.gateName}{task.assigneeUserId ? ` · ${task.assigneeName ?? `Employee ${task.assigneeUserId}`}` : ""}</Text>
        {button("Open task record", () => router.push(`/work-hub/record?kind=task&id=${encodeURIComponent(task.id)}` as never))}
        {task.gateHopper.completedAt && <Text style={muted}>Completed · {task.completedByName ?? `Employee ${task.gateHopper.completedById}`} · {new Date(task.gateHopper.completedAt).toLocaleString()}{"\n"}{task.gateHopper.completionNote}</Text>}
        {task.gateHopper.clearedAt && <Text style={muted}>Removed from hopper; history retained.</Text>}
        {["open", "in_progress"].includes(task.status) && !task.gateHopper.clearedAt && <>
          <TextInput accessibilityLabel="Completion note" placeholder="What was done?" placeholderTextColor="#b3b3b3" multiline maxLength={2000} value={notes[task.id] ?? ""} onChangeText={value => setNotes(prior => ({ ...prior, [task.id]: value }))} style={input} />
          {button("Complete task", () => act({ action: "complete", taskId: task.id, expectedVersion: task.version, note: notes[task.id]?.trim() }), !options.data?.canComplete || !notes[task.id]?.trim())}
          {!options.data?.canComplete && <Text style={muted}>Completion is available while on shift.</Text>}
          {options.data?.canManage && <>
            {options.data.people.filter(person => person.vendorId === task.ownerOrgId).map(person => button(`${(Object.hasOwn(assignees, task.id) ? assignees[task.id] : task.assigneeUserId) === person.userId ? "✓ " : ""}${person.name}`, () => setAssignees(prior => ({ ...prior, [task.id]: person.userId }))))}
            {button("Leave unassigned", () => setAssignees(prior => ({ ...prior, [task.id]: null })))}
            {button("Assign", () => act({ action: "assign", taskId: task.id, expectedVersion: task.version, assigneeUserId: Object.hasOwn(assignees, task.id) ? assignees[task.id] : task.assigneeUserId }))}
            {!task.assigneeUserId && <>{button("Clear", () => act({ action: "clear", taskId: task.id, expectedVersion: task.version }))}{button("Delete", () => act({ action: "delete", taskId: task.id, expectedVersion: task.version }))}</>}
          </>}
        </>}
      </View>}
    </View>)}
    {page.data?.unimported?.map(item => <View key={item.id} style={{ gap: 6 }}><Text style={{ color: "#ececec" }}>{item.text} · {new Date(item.createdAt).toLocaleString()}</Text><Text style={muted}>{item.siteName} · {item.gateName}</Text><Text style={muted}>Original action retained. Office must select its vendor before it enters the task hopper.</Text>{options.data?.canManage && options.data.gates.filter(g => g.stationId === item.stationId).map(g => button(`Add original to hopper · ${g.vendorName}`, () => act({ action: "import", taskId: item.id, stationId: item.stationId, vendorId: g.vendorId })))}</View>)}
    {!page.isPending && !page.isError && !all.length && <Text style={muted}>No unassigned tasks.</Text>}
    {page.data?.nextBefore && button("More tasks", () => setBefore(page.data!.nextBefore))}
    {gates.length !== 1 && <>{button(selected ? `${selected.siteName} · ${selected.gateName}` : "Choose site and gate", () => setSelectingGate(!selectingGate))}{selectingGate && gates.map(item => button(`${item.siteName} · ${item.gateName}${user?.role === "admin" ? ` · ${item.vendorName}` : ""}`, () => { setGate(`${item.vendorId}:${item.stationId}`); setSelectingGate(false); }))}</>}
    <TextInput accessibilityLabel="Unassigned task" placeholder="What needs doing?" placeholderTextColor="#b3b3b3" multiline maxLength={2000} value={text} onChangeText={setText} style={[input, { minHeight: 100, textAlignVertical: "top" }]} />
    {button("Add task", () => selected && act({ action: "create", stationId: selected.stationId, vendorId: selected.vendorId, text: text.trim() }), !selected || !text.trim() || !options.data?.canManage && !options.data?.canComplete)}
    {!!error && <Text accessibilityRole="alert" style={muted}>{error}</Text>}
    {pending && !busy && button("Check / retry saved request", () => void send(pending), false, true)}
  </View>;
}
