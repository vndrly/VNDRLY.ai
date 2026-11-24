import React from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useGateCopy } from "@/components/gate/GateChrome";
import HomeTaskActions, { type HomeTask } from "./HomeTaskActions";
import { TaskIcon } from "./HomeTaskCardRow";

export default function HomeTaskCardRecord({ task, company, mine, stale, elapsed }: {
  task: HomeTask;
  company: boolean;
  mine: boolean;
  stale: boolean;
  elapsed: string | null;
}) {
  const c = useGateCopy();
  const color = stale ? "#fbbf24" : mine ? "#4ade80" : "#ececec";
  const assignee = task.assigneeName ?? (task.assigneeUserId ? `${c("Employee", "Empleado")} ${task.assigneeUserId}` : c("Unassigned", "Sin asignar"));
  const timing = elapsed
    ? task.status === "completed" ? `${c("Completed in", "Completada en")} ${elapsed}`
      : `${!task.assigneeUserId ? c("Created", "Creada hace") : c("Assigned", "Asignada hace")} ${elapsed}${c(" ago", "")}${stale ? ` · ${c("Over 30 days", "Más de 30 días")}` : ""}`
    : c("Elapsed time unavailable", "Tiempo transcurrido no disponible");
  return <View style={{ borderBottomWidth: 1, borderBottomColor: "#343434", paddingBottom: 9 }}>
    <Pressable accessibilityRole="link" accessibilityLabel={task.title} onPress={() => router.push(`/work-hub/record?kind=task&id=${encodeURIComponent(task.id)}` as never)} style={({ pressed }) => ({ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, opacity: pressed ? 0.72 : 1 })}>
      <View style={{ flex: 1 }}>
        <Text style={{ color, fontSize: 13, fontWeight: "700" }}>{task.title}</Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginTop: 2 }}>
          <Text style={{ color: mine ? "#4ade80" : stale ? "#fbbf24" : "#a3a3a3", fontSize: 11, flexShrink: 1 }}>{assignee} · {task.status.replaceAll("_", " ")}</Text>
          <Text style={{ color: mine ? "#4ade80" : stale ? "#fbbf24" : "#a3a3a3", fontSize: 11, textAlign: "right", flexShrink: 1 }}>{timing}</Text>
        </View>
        {task.siteName ? <Text style={{ color, fontSize: 11, marginTop: 2 }}>{task.siteName}{task.gateName ? ` · ${task.gateName}` : ""}</Text> : null}
      </View>
      <TaskIcon kind="chevron" size={16} />
    </Pressable>
    <HomeTaskActions task={task} company={company} webCard />
  </View>;
}
