import React from "react";
import { router } from "expo-router";
import {
  GatePage,
  GateCard,
  GateRow,
  useGateCopy,
} from "@/components/gate/GateChrome";
import NativeJournal from "@/components/work-hub/NativeJournal";
import GateStaffingAlerts from "@/components/GateStaffingAlerts";
import { useAuth } from "@/hooks/use-auth";
import { gateManager } from "@/lib/gate-release";
export default function GateWorkHub() {
  const c = useGateCopy(),
    { user } = useAuth();
  const open = (p: string) => router.push(p as never);
  return (
    <GatePage title="Work Hub">
      <GateCard title={c("My work", "Mi trabajo")} icon="briefcase">
        <GateRow
          label={c("Calendar and shifts", "Calendario y turnos")}
          icon="calendar"
          onPress={() => open("/work-hub/calendar")}
        />
        <GateRow
          label={c("Tasks and forms", "Tareas y formularios")}
          icon="check-square"
          onPress={() => open("/work-hub/tasks-forms")}
        />
        <GateRow
          label={c("Handoff and follow-ups", "Relevo y seguimientos")}
          icon="repeat"
          onPress={() => open("/handoff")}
        />
        <GateRow
          label={c("Shift Notes", "Notas del turno")}
          icon="file-text"
          onPress={() => open("/shift-notes")}
        />
        <GateRow
          label={c("Report a safety concern", "Reportar un riesgo")}
          icon="alert-triangle"
          onPress={() => open("/safety-report")}
        />
        <GateRow
          label={c("My safety reports", "Mis reportes de seguridad")}
          onPress={() => open("/safety-my-reports")}
        />
      </GateCard>
      <GateCard
        title={c("Team communication", "Comunicación del equipo")}
        icon="message-circle"
      >
        <GateRow
          label={c("Chats", "Chats")}
          icon="message-square"
          onPress={() => open("/work-hub/chat")}
        />
        <GateRow
          label={c("Calls", "Llamadas")}
          icon="phone"
          onPress={() => open("/work-hub/calls")}
        />
        <GateRow
          label={c("Meetings", "Reuniones")}
          icon="users"
          onPress={() => open("/work-hub/meetings")}
        />
        <GateRow
          label={c("Notifications", "Notificaciones")}
          icon="bell"
          onPress={() => open("/gate-notifications")}
        />
      </GateCard>
      {gateManager(user) && <GateStaffingAlerts />}
      <NativeJournal />
      <GateCard title={c("My account", "Mi cuenta")} icon="user">
        <GateRow
          label={c(
            "Profile, credentials and device settings",
            "Perfil, credenciales y dispositivo",
          )}
          onPress={() => open("/profile")}
        />
      </GateCard>
    </GatePage>
  );
}
