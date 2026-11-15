import React, { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import type { VConnectionSelection } from "@/hooks/use-assistant";
import TogglePillButton from "./TogglePillButton";
type Connection = { id: string; provider: string; scope: "company" | "personal"; capabilities: string[] };
export default function CooperativeVContext({ selectConnection, selectSavedTask, taskId, disabled }: { selectConnection?: (value: VConnectionSelection | null) => void; selectSavedTask?: (id: string | null) => void; taskId?: string; disabled: boolean }) {
  const { user } = useAuth(), { t } = useTranslation(), colors = useColors();
  const [connections, setConnections] = useState<Connection[]>([]), [selected, setSelected] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<{ taskId: string; completed: { id: string }[]; remaining: { id: string; state: string; detail?: string }[]; needed: string } | null>(null);
  useEffect(() => {
    let alive = true; const scope = captureAuthScope(); setRecovery(null); selectSavedTask?.(null);
    if (taskId && /^[0-9a-f-]{36}$/i.test(taskId)) void apiFetch<NonNullable<typeof recovery>>(`/api/assistant/tasks/${taskId}/recovery`, {}, scope).then(value => {
      if (alive && isAuthScopeCurrent(scope) && value.taskId === taskId && Array.isArray(value.completed) && Array.isArray(value.remaining)) { setRecovery(value); selectSavedTask?.(value.taskId); }
    }).catch(() => undefined);
    return () => { alive = false; selectSavedTask?.(null); };
  }, [taskId, user?.id, user?.activeMembershipId, selectSavedTask]);
  useEffect(() => {
    let alive = true; const scope = captureAuthScope(); setConnections([]); setSelected(null); selectConnection?.(null);
    void apiFetch<{ connections: Connection[] }>("/api/assistant/connections", {}, scope).then(result => {
      if (!alive || !isAuthScopeCurrent(scope)) return;
      setConnections(result.connections);
    }).catch(() => undefined);
    return () => { alive = false; selectConnection?.(null); };
  }, [user?.id, user?.activeMembershipId, selectConnection]);
  const choose = (connection: Connection, savePersonalContentToCompany: boolean) => {
    selectConnection?.({ connectionId: connection.id, scope: connection.scope, personalPermission: connection.scope === "personal", savePersonalContentToCompany }); setSelected(connection.id);
  };
  if (!taskId && (!selectConnection || connections.length === 0)) return null;
  return <View style={{ gap: 8, paddingVertical: 8 }}>
    {recovery ? <View style={{ gap: 6 }}>
      <Text style={{ color: colors.text }}>{t("nativeCooperation.savedTask", { id: recovery.taskId })}</Text>
      <Text style={{ color: colors.text }}>{t("nativeCooperation.completed")}: {recovery.completed.map(step => step.id).join(", ")}</Text>
      <Text style={{ color: colors.text }}>{t("nativeCooperation.remaining")}: {recovery.remaining.map(step => `${step.id} · ${step.state}`).join(", ")}</Text>
      <Text style={{ color: colors.mutedForeground }}>{recovery.needed}</Text>
    </View> : taskId ? <Text style={{ color: colors.mutedForeground }}>{t("nativeCooperation.taskUnavailable")}</Text> : null}
    {selectConnection ? connections.map(connection => <TogglePillButton key={connection.id} disabled={disabled} onPress={() => {
      if (connection.scope === "company") choose(connection, false);
      else Alert.alert(t("nativeCooperation.personalTitle"), t("nativeCooperation.personalPermission"), [
        { text: t("nativeOperations.cancel"), style: "cancel" },
        { text: t("nativeCooperation.private"), onPress: () => choose(connection, false) },
        { text: t("nativeCooperation.companySave"), onPress: () => choose(connection, true) },
      ]);
    }}>{`${connection.provider} · ${t(`nativeCooperation.${connection.scope}`)}${selected === connection.id ? " ✓" : ""}`}</TogglePillButton>) : null}
    {selected ? <TogglePillButton disabled={disabled} onPress={() => { selectConnection?.(null); setSelected(null); }}>{t("nativeCooperation.clearConnection")}</TogglePillButton> : null}
  </View>;
}
