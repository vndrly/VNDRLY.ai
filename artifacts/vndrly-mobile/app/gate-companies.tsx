import React, { useState } from "react";
import { router } from "expo-router";
import { Text } from "react-native";
import { useAuth } from "@/hooks/use-auth";
import { useGateQuery } from "@/hooks/use-gate-query";
import {
  GatePage,
  GateCard,
  GateRow,
  GateField,
  GateError,
  GateLoading,
  gateStyle,
  useGateCopy,
} from "@/components/gate/GateChrome";
export default function Companies() {
  const c = useGateCopy(),
    { user } = useAuth(),
    [search, setSearch] = useState("");
  const q = useGateQuery<{ id: number; name: string }[]>(
    "/api/vendors",
    user?.role === "admin",
  );
  return (
    <GatePage title={c("Gate companies", "Empresas de acceso")} back>
      <GateCard
        title={c("Choose a company", "Selecciona una empresa")}
        icon="briefcase"
      >
        {user?.role !== "admin" ? (
          <GateError
            message={c(
              "Platform administrator access required.",
              "Se requiere acceso de administrador de plataforma.",
            )}
          />
        ) : (
          <>
            <GateField
              label={c("Find company", "Buscar empresa")}
              value={search}
              onChangeText={setSearch}
            />
            <GateError
              message={q.error?.message}
              retry={() => void q.refetch()}
            />
            {q.isLoading && <GateLoading />}
            {q.data
              ?.filter((x) =>
                x.name.toLowerCase().includes(search.toLowerCase()),
              )
              .map((x) => (
                <GateRow
                  key={x.id}
                  label={x.name}
                  onPress={() =>
                    router.push(("/gate-admin?vendorId=" + x.id) as never)
                  }
                />
              ))}
            {q.isSuccess && !q.data?.length && (
              <Text style={gateStyle.muted}>
                {c("No companies found.", "No se encontraron empresas.")}
              </Text>
            )}
          </>
        )}
      </GateCard>
    </GatePage>
  );
}
