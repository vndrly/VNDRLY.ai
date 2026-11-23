import React, { useState } from "react";
import { useGateCompany } from "@/hooks/use-gate-company";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { useGateQuery } from "@/hooks/use-gate-query";
import { gateManager } from "@/lib/gate-release";
import {
  GatePage,
  GateCard,
  GateRow,
  GateError,
  gateStyle,
  useGateCopy,
} from "@/components/gate/GateChrome";
function SettingsGroup({ title, icon, children, collapsible }: {
  title: string;
  icon: React.ComponentProps<typeof GateCard>["icon"];
  children: React.ReactNode;
  collapsible: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!collapsible) return <GateCard title={title} icon={icon}>{children}</GateCard>;
  return (
    <View>
      <GateRow
        label={title}
        icon={expanded ? "chevron-down" : "chevron-right"}
        expanded={expanded}
        onPress={() => setExpanded(open => !open)}
      />
      {expanded && <View style={{ paddingLeft: 12 }}>{children}</View>}
    </View>
  );
}

export default function GateSettings({ embedded = false }: { embedded?: boolean }) {
  const c = useGateCopy(),
    { user, activeMembership } = useAuth();
  const home = useGateQuery<{
    capabilities?: { canManageGateLocations?: boolean };
  }>("/api/work-hub/home");
  const vendorId = useGateCompany();
  const open = (p: string) =>
    router.push(
      (vendorId && ["/gate-staff", "/gate-services"].includes(p)
        ? p + "?vendorId=" + vendorId
        : p) as never,
    );
  if (!gateManager(user))
    return embedded ? null : (
      <GatePage title={c("Administration", "Administración")} back>
        <GateError
          message={c(
            "Your current role does not manage Gate operations.",
            "Tu rol actual no administra operaciones de acceso.",
          )}
        />
      </GatePage>
    );
  const admin =
    user?.role === "admin" ||
    activeMembership?.role === "admin" ||
    user?.vendorRole === "office";
  const sections = (
    <>
      {user?.role === "admin" && (
        <SettingsGroup collapsible={embedded} icon="shield"
          title={c("Platform administration", "Administración de plataforma")}
        >
          <GateRow
            label={c("Choose Gate company", "Elegir empresa de acceso")}
            detail={vendorId ? "Company #" + vendorId : undefined}
            onPress={() => open("/gate-companies")}
          />
          <GateRow
            label={c(
              "Site setup and linked gates",
              "Configuración de sitios y accesos vinculados",
            )}
            onPress={() => open("/gate-setup")}
          />
        </SettingsGroup>
      )}
      <SettingsGroup collapsible={embedded} icon="briefcase"
        title={
          activeMembership?.orgName ??
          c("Company context", "Contexto de empresa")
        }
      >
        <Text style={gateStyle.muted}>
          {c(
            "Changes apply to your active company and authorized sites.",
            "Los cambios se aplican a tu empresa activa y sitios autorizados.",
          )}
        </Text>
        {!embedded && (
          <GateRow
            label={c("Switch company or role", "Cambiar empresa o rol")}
            onPress={() => open("/profile")}
          />
        )}
      </SettingsGroup>
      <SettingsGroup collapsible={embedded} icon="users"
        title={c("People and coverage", "Personal y cobertura")}
      >
        {admin && (
          <GateRow label={c("Employees", "Empleados")} icon="users" onPress={() => open("/employees")} />
        )}
        {admin && (
          <GateRow
            label={c("Groups", "Grupos")}
            icon="users"
            onPress={() => open("/groups")}
          />
        )}
        {admin && (
          <GateRow
            label={c("Staff and site access", "Personal y acceso a sitios")}
            detail={c(
              "One site authorization controls assignment to that site",
              "Una autorización asigna a la persona al sitio",
            )}
            onPress={() => open("/gate-staff")}
          />
        )}
        <GateRow
          label={c("Schedule shifts", "Programar turnos")}
          icon="calendar"
          onPress={() => open("/work-hub/calendar")}
        />
        <GateRow
          label={c(
            "Watch coverage and recovery",
            "Cobertura y recuperación de guardia",
          )}
          icon="map-pin"
          onPress={() => open("/gate-map")}
        />
        <GateRow
          label={c("Handoff follow-ups", "Seguimientos de relevo")}
          onPress={() => open("/handoff")}
        />
      </SettingsGroup>
      {admin && (
        <SettingsGroup collapsible={embedded} icon="settings"
          title={c("Company operations", "Operaciones de empresa")}
        >
          <GateRow label={c("Import & Export", "Importar y exportar")} icon="repeat" onPress={() => open("/import-export")} />
          <GateRow label={c("Billing & Payroll", "Facturación y nómina")} icon="dollar-sign" onPress={() => open("/billing-payroll")} />
          <GateError
            message={home.error?.message}
            retry={() => void home.refetch()}
          />
          <GateRow
            label={c(
              "Site setup and linked gates",
              "Sitios y accesos vinculados",
            )}
            onPress={() => open("/gate-setup")}
          />
          {home.data?.capabilities?.canManageGateLocations && (
            <GateRow
              label={c("Gate locations and geofences", "Accesos y geocercas")}
              onPress={() => open("/gate-locations")}
            />
          )}
          <GateRow
            label={c(
              "Gate billing and daily review",
              "Facturación y revisión diaria",
            )}
            onPress={() => open("/gate-billing")}
          />
          <GateRow
            label={c("Company documents", "Documentos de empresa")}
            icon="file-text"
            onPress={() => open("/gate-documents")}
          />
          <GateRow
            label={c("Services and rates", "Servicios y tarifas")}
            onPress={() => open("/gate-services")}
          />
        </SettingsGroup>
      )}
    </>
  );
  return embedded ? sections : (
    <GatePage title={c("Gate Settings", "Configuración de acceso")} back>
      {sections}
    </GatePage>
  );
}
