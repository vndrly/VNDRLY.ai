import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DismissibleModal from "@/components/DismissibleModal";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { mobileCommandEnvelope } from "@/lib/work-hub-mobile";

export type HomeTask = {
  id: string; title: string; status: string; version?: number;
  assigneeUserId?: number | null; assigneeName?: string | null;
  createdAt: string; assignedAt?: string | null; completedAt?: string | null;
  siteName?: string; gateName?: string;
  ownerOrgType?: "vendor" | "partner"; ownerOrgId?: number;
  completionResolution?: string | null;
  gateHopper?: { completedById?: number; completionNote?: string; clearedAt?: string } | null;
};

type AssignmentOptions = { people: { userId: number; name: string; membershipRole: string; vendorRole: string | null }[] };

export default function HomeTaskActions({ task, company, webCard = false }: { task: HomeTask; company: boolean; webCard?: boolean }) {
  const { user } = useAuth();
  const { primary } = useColors();
  const cache = useQueryClient();
  const [mode, setMode] = useState<"assign" | "complete" | null>(null);
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ path: string; method: string; body: string } | null>(null);
  const options = useQuery({ queryKey: ["work-hub", "task-assignment-options", user?.id, task.id], queryFn: () => apiFetch<AssignmentOptions>(`/api/work-hub/tasks/${encodeURIComponent(task.id)}/assignment-options`), enabled: mode === "assign", retry: false });
  const gateOptions = useQuery({ queryKey: ["gate-task-hopper-options", user?.id, task.id], queryFn: () => apiFetch<{ canComplete: boolean }>(`/api/work-hub/gate-task-hopper/options?taskId=${encodeURIComponent(task.id)}`), enabled: mode === "complete" && !!task.gateHopper && task.status !== "completed", retry: false });
  if (!user || !task.version || !task.ownerOrgId || !task.ownerOrgType && !task.gateHopper || task.status === "cancelled") return null;

  const owner = { type: task.ownerOrgType ?? "vendor", id: task.ownerOrgId } as { type: "vendor" | "partner"; id: number };
  const button = (label: string, onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${task.title}`} disabled={disabled || busy} onPress={onPress} style={{ minHeight: 40, justifyContent: "center", paddingHorizontal: 10, borderWidth: 1, borderColor: primary, borderRadius: 8, opacity: disabled || busy ? 0.5 : 1 }}><Text style={{ color: "#ececec", fontSize: 12 }}>{label}</Text></Pressable>;
  const footerAction = (label: string, onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${task.title}`} disabled={disabled || busy} onPress={onPress} style={{ minHeight: 28, justifyContent: "center", opacity: disabled || busy ? 0.5 : 1 }}><Text style={{ color: "#a3a3a3", fontSize: 11 }}>{label}</Text></Pressable>;
  const close = () => { if (busy) return; setMode(null); setError(""); setSaved(null); setResolution(""); };
  const send = async (request: { path: string; method: string; body: string }) => {
    setSaved(request); setBusy(true); setError("");
    try {
      await apiFetch(request.path, { method: request.method, body: request.body });
      await cache.invalidateQueries({ queryKey: ["work-hub"] });
      setSaved(null); setMode(null); setResolution("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Task update was not confirmed."); }
    finally { setBusy(false); }
  };
  const assign = (assigneeUserId: number) => {
    if (saved) return;
    const operationId = randomUUID();
    const request = task.gateHopper
      ? { path: "/api/work-hub/gate-task-hopper", method: "POST", body: JSON.stringify({ operationId, actorUserId: user.id, action: "assign", taskId: task.id, expectedVersion: task.version, assigneeUserId }) }
      : { path: `/api/work-hub/tasks/${encodeURIComponent(task.id)}`, method: "PATCH", body: JSON.stringify(mobileCommandEnvelope(owner, { assigneeUserId }, task.version, { kind: "organization", id: owner.id }, operationId)) };
    void send(request);
  };
  const complete = () => {
    if (saved || !resolution.trim()) return;
    const operationId = randomUUID();
    const request = task.gateHopper
      ? { path: "/api/work-hub/gate-task-hopper", method: "POST", body: JSON.stringify({ operationId, actorUserId: user.id, action: "complete", taskId: task.id, expectedVersion: task.version, note: resolution.trim() }) }
      : { path: `/api/work-hub/tasks/${encodeURIComponent(task.id)}`, method: "PATCH", body: JSON.stringify(mobileCommandEnvelope(owner, { action: "complete", resolution: resolution.trim() }, task.version, { kind: "organization", id: owner.id }, operationId)) };
    void send(request);
  };
  return <>
    <View style={webCard ? { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 6 } : { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 8, paddingBottom: 12 }}>
      {company && task.status !== "completed" ? <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>{webCard ? footerAction("(Re)Assign", () => setMode("assign")) : button("(Re)Assign", () => setMode("assign"))}{webCard ? <Text style={{ color: "#a3a3a3", fontSize: 11 }}>|</Text> : null}{webCard ? footerAction("Assume", () => assign(user.id), task.assigneeUserId === user.id) : button("Assume", () => assign(user.id), task.assigneeUserId === user.id)}</View> : null}
      {webCard ? <Pressable accessibilityRole="switch" accessibilityState={{ checked: task.status === "completed" }} accessibilityLabel={`Completed ${task.title}`} onPress={() => setMode("complete")} style={{ minHeight: 28, flexDirection: "row", alignItems: "center", gap: 7, marginLeft: "auto" }}><Text style={{ color: "#a3a3a3", fontSize: 11 }}>Completed</Text><View style={{ width: 26, height: 11, borderWidth: 1, borderColor: primary, borderRadius: 7, justifyContent: "center", alignItems: task.status === "completed" ? "flex-end" : "flex-start", paddingHorizontal: 1 }}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: primary }} /></View></Pressable> : button(task.status === "completed" ? "Completed ✓" : "Completed", () => setMode("complete"))}
    </View>
    <DismissibleModal dismissLabel="close" visible={mode !== null} transparent onRequestClose={close}>
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: "#0009", padding: 20 }}><View style={{ backgroundColor: "#242426", borderColor: primary, borderWidth: 2, borderRadius: 16, padding: 18, gap: 10 }}>
        <Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 18, fontWeight: "700" }}>{mode === "assign" ? "Assign to" : "Resolution"}</Text>
        {mode === "assign" ? <>
          {options.isPending ? <Text style={{ color: "#a3a3a3" }}>Loading people…</Text> : null}
          {options.isError ? <Text accessibilityRole="alert" style={{ color: "#fca5a5" }}>People could not load. Close and reopen to retry.</Text> : null}
          {options.data?.people.map(person => button(`${person.name} · ${person.membershipRole === "admin" ? "Admin" : person.vendorRole?.replaceAll("_", " ") ?? "Company member"}${person.userId === task.assigneeUserId ? " · current" : ""}`, () => assign(person.userId), person.userId === task.assigneeUserId))}
          {options.data?.people.length === 0 ? <Text style={{ color: "#a3a3a3" }}>No available company members.</Text> : null}
        </> : task.status === "completed" ? <Text style={{ color: "#ececec" }}>{task.gateHopper?.completionNote ?? task.completionResolution ?? "No resolution was recorded for this earlier task."}</Text> : <>
          <TextInput accessibilityLabel="Resolution" multiline maxLength={2000} editable={!busy && !saved} value={resolution} onChangeText={setResolution} placeholder="What was done to resolve this task?" placeholderTextColor="#a3a3a3" style={{ minHeight: 90, borderColor: primary, borderWidth: 1, borderRadius: 8, color: "#ececec", padding: 10, textAlignVertical: "top" }} />
          {task.gateHopper && gateOptions.data && !gateOptions.data.canComplete ? <Text style={{ color: "#a3a3a3" }}>Start your shift to complete hopper tasks.</Text> : null}
          {button(saved ? "Retry saved completion" : "Save resolution & complete", () => saved ? void send(saved) : complete(), !saved && (!resolution.trim() || !!task.gateHopper && !gateOptions.data?.canComplete))}
        </>}
        {error ? <Text accessibilityRole="alert" style={{ color: "#fca5a5" }}>{error}</Text> : null}
        {saved && mode === "assign" ? button("Retry saved request", () => void send(saved)) : null}
        {button("Close", close)}
      </View></View>
    </DismissibleModal>
  </>;
}
