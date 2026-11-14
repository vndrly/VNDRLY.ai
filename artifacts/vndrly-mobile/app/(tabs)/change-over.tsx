import React, { useEffect } from "react";
import { Text, View } from "react-native";
import { router, Redirect, useLocalSearchParams } from "expo-router";
import type { ChangeOverState } from "@workspace/gate-booth";
import { useAuth } from "@/hooks/use-auth";
import { useGateQuery } from "@/hooks/use-gate-query";
import { useGateSelection } from "@/lib/gate-selection";
import { useGateOperatingContext } from "@/hooks/use-gate-operating-context";
import { gateManager } from "@/lib/gate-release";
import {
  GatePage,
  GateCard,
  GateRow,
  GateError,
  GateLoading,
  gateStyle,
  useGateCopy,
} from "@/components/gate/GateChrome";
import GateSiteGateSelect from "@/components/GateSiteGateSelect";
import WorkdayControls from "@/components/WorkdayControls";
import GateStaffingAlerts from "@/components/GateStaffingAlerts";
export default function GateDashboard() {
  const c = useGateCopy(),
    { user, activeMembershipId } = useAuth(),
    selection = useGateSelection(user, activeMembershipId),
    watch = useGateOperatingContext();
  const sites = useGateQuery<{
    sites: { id: number; name: string; supervisor: boolean }[];
  }>("/api/gate-change-over/sites");
  const gates = useGateQuery<{
    gates: { id: string; name: string; siteId: number }[];
  }>("/api/gate-change-over/map");
  const params = useLocalSearchParams<{
    siteId: string;
    stationId: string;
    purpose: string;
    gateMode: string;
    workHubShiftId: string;
  }>();
  useEffect(() => {
    const target = gates.data?.gates.find(
      (g) => g.id === params.stationId && g.siteId === Number(params.siteId),
    );
    if (
      target &&
      (selection.selection?.stationId !== target.id ||
        selection.selection?.siteId !== target.siteId)
    )
      selection.save(target.siteId, target.id);
  }, [gates.data, params.siteId, params.stationId]);
  const selected = selection.selection,
    gate = gates.data?.gates.find(
      (g) => g.id === selected?.stationId && g.siteId === selected.siteId,
    );
  const state = useGateQuery<ChangeOverState>(
    "/api/gate-change-over/" + (gate?.id ?? "") + "/state",
    !!gate,
    15000,
  );
  const watches = useGateQuery<{
    watches: {
      userId: number;
      name: string;
      stationId: string;
      siteName: string;
      gateName: string;
      startedAt: string;
    }[];
  }>("/api/gate-change-over/watches", gateManager(user), 30000);
  const open = (path: string) => router.push(path as never),
    handoff = () =>
      open(
        "/handoff" +
          (gate
            ? "?siteId=" +
              gate.siteId +
              "&stationId=" +
              encodeURIComponent(gate.id)
            : ""),
      );
  const snapshot = state.data?.snapshot,
    own = state.data?.shift?.operator_id === user?.id;
  if (params.purpose === "assume" || params.gateMode === "1")
    return <Redirect href={{ pathname: "/handoff", params }} />;
  return (
    <GatePage title={c("Gate Dashboard", "Panel de acceso")}>
      <GateCard title={c("My workday", "Mi jornada")} icon="clock">
        <WorkdayControls />
        <Text style={gateStyle.muted}>
          {watch.operating
            ? c("Standing watch at ", "De guardia en ") +
              watch.operating.siteName +
              " · " +
              watch.operating.gateName
            : c(
                "No active watch. Select a gate and review the handoff to assume watch.",
                "Sin guardia activa. Selecciona un acceso y revisa el relevo para asumir la guardia.",
              )}
        </Text>
        {watch.operating && (
          <GateRow
            label={c("Return to my gate", "Volver a mi acceso")}
            onPress={() => {
              watch.myGate();
              open("/gate");
            }}
          />
        )}
      </GateCard>
      <GateCard title={c("Site and gate", "Sitio y acceso")} icon="map-pin">
        <GateError
          message={sites.error?.message ?? gates.error?.message}
          retry={() => {
            void sites.refetch();
            void gates.refetch();
          }}
        />
        {sites.isLoading ? (
          <GateLoading />
        ) : (
          <GateSiteGateSelect
            sites={sites.data?.sites ?? []}
            siteId={selected?.siteId}
            gate={gate}
            onChange={(siteId, stationId) => selection.save(siteId, stationId)}
          />
        )}
        {sites.isSuccess && !sites.data?.sites.length && (
          <Text style={gateStyle.text}>
            {c(
              "No authorized sites. Ask your administrator to enable site access on your staff profile.",
              "Sin sitios autorizados. Solicita acceso al administrador en tu perfil de empleado.",
            )}
          </Text>
        )}
        {gate && (
          <>
            <GateRow
              label={
                own
                  ? c("Open my gate", "Abrir mi acceso")
                  : c(
                      "Review handoff / assume watch",
                      "Revisar relevo / asumir guardia",
                    )
              }
              icon="log-in"
              onPress={own ? () => open("/gate") : handoff}
            />
            <GateError
              message={state.error?.message}
              retry={() => void state.refetch()}
            />
            {state.isLoading && <GateLoading />}
            {state.data && (
              <Text style={gateStyle.muted}>
                {state.data.shift
                  ? c("On watch: ", "De guardia: ") +
                    state.data.shift.operator_name
                  : c("No confirmed watch", "Sin guardia confirmada")}
              </Text>
            )}
          </>
        )}
      </GateCard>
      {snapshot && (
        <GateCard
          title={c("Current watch activity", "Actividad de la guardia")}
          icon="activity"
        >
          <View style={gateStyle.columns}>
            {[
              [c("Check-ins", "Entradas"), snapshot.metrics.checkIns],
              [c("Check-outs", "Salidas"), snapshot.metrics.checkOuts],
              [
                c("Vehicles on site", "Vehículos en sitio"),
                snapshot.metrics.onSiteVehicles,
              ],
              [
                c("Pending admission", "Admisión pendiente"),
                snapshot.metrics.pendingAdmission,
              ],
            ].map(([label, value]) => (
              <View
                key={label}
                style={{ minWidth: "44%", gap: 4, paddingVertical: 6 }}
              >
                <Text style={[gateStyle.title, { fontSize: 24 }]}>{value}</Text>
                <Text style={gateStyle.muted}>{label}</Text>
              </View>
            ))}
          </View>
          <Text style={gateStyle.muted}>
            {c("Updated ", "Actualizado ") +
              new Date(snapshot.generatedAt).toLocaleString()}
          </Text>
          <GateRow
            label={c("View Gate Log", "Ver registro")}
            icon="list"
            onPress={() => open("/gate-history")}
          />
        </GateCard>
      )}
      <GateCard
        title={c("Next actions", "Próximas acciones")}
        icon="check-square"
      >
        {!gate ? (
          <Text style={gateStyle.muted}>
            {c(
              "Select an authorized site and gate to see its work.",
              "Selecciona un sitio y acceso autorizado para ver el trabajo.",
            )}
          </Text>
        ) : (
          <>
            {!own && (
              <GateRow
                label={c(
                  "Review and acknowledge the handoff",
                  "Revisar y confirmar el relevo",
                )}
                onPress={handoff}
              />
            )}
            {own && (
              <GateRow
                label={c(
                  "Check in or check out traffic",
                  "Registrar entrada o salida",
                )}
                icon="log-in"
                onPress={() => open("/gate")}
              />
            )}
            {state.data?.items
              .filter((i) => i.status === "open")
              .slice(0, 3)
              .map((i) => (
                <GateRow
                  key={i.id}
                  label={i.text}
                  detail={c("Open handoff follow-up", "Seguimiento abierto")}
                  onPress={handoff}
                />
              ))}
            {own && (
              <GateRow
                label={c("Prepare shift handoff", "Preparar relevo")}
                icon="repeat"
                onPress={handoff}
              />
            )}
          </>
        )}
      </GateCard>
      {gateManager(user) && (
        <>
          <GateStaffingAlerts />
          <GateCard
            title={c("Watch coverage", "Cobertura de guardia")}
            icon="users"
          >
            <GateError
              message={watches.error?.message}
              retry={() => void watches.refetch()}
            />
            {watches.isLoading && <GateLoading />}
            {watches.data?.watches.length === 0 && (
              <Text style={gateStyle.muted}>
                {c(
                  "No active watches in your authorized scope.",
                  "No hay guardias activas en tu ámbito autorizado.",
                )}
              </Text>
            )}
            {watches.data?.watches.map((w) => (
              <GateRow
                key={w.stationId}
                label={w.siteName + " · " + w.gateName}
                detail={w.name + " · " + new Date(w.startedAt).toLocaleString()}
                onPress={() => open("/gate-map")}
              />
            ))}
            <GateRow
              label={c("Staff shifts and coverage", "Turnos y cobertura")}
              icon="calendar"
              onPress={() => open("/work-hub/calendar")}
            />
            <GateRow
              label={c(
                "Manage Gate operations",
                "Administrar operaciones de acceso",
              )}
              icon="settings"
              onPress={() => open("/gate-admin")}
            />
          </GateCard>
        </>
      )}
      <GateCard title={c("My workspace", "Mi espacio")} icon="briefcase">
        <GateRow
          label="Work Hub"
          detail={c(
            "Shifts, tasks and team communication",
            "Turnos, tareas y comunicación",
          )}
          onPress={() => open("/work-hub")}
        />
        <GateRow
          label={c("Shift Notes", "Notas del turno")}
          icon="file-text"
          onPress={() => open("/shift-notes")}
        />
        <GateRow
          label={c("My profile and credentials", "Mi perfil y credenciales")}
          icon="user"
          onPress={() => open("/profile")}
        />
      </GateCard>
    </GatePage>
  );
}
