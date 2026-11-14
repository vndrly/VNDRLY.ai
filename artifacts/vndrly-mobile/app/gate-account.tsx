import React, { useState } from "react";
import { Text, Linking } from "react-native";
import { useAuth } from "@/hooks/use-auth";
import { useGateQuery } from "@/hooks/use-gate-query";
import { apiFetch } from "@/lib/api";
import {
  GatePage,
  GateCard,
  GateRow,
  GateField,
  GateError,
  gateStyle,
  useGateCopy,
} from "@/components/gate/GateChrome";
import TogglePillButton from "@/components/TogglePillButton";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
type DeletionRequest = { id: string; status: string; requestedAt: string };
export default function GateAccount() {
  const c = useGateCopy(),
    { user } = useAuth(),
    [review, setReview] = useState(false),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const query = useGateQuery<{ request: DeletionRequest | null }>(
    "/api/account/deletion-request",
  );
  const queue = useGateQuery<{
    requests: {
      user_id: number;
      display_name: string;
      email: string;
      request: DeletionRequest;
    }[];
  }>("/api/admin/account-deletion-requests", user?.role === "admin");
  const submit = async () => {
    if (busy || confirmation !== "DELETE" || !password) return;
    const scope = captureAuthScope();
    setBusy(true);
    setError("");
    try {
      await apiFetch(
        "/api/account/deletion-request",
        { method: "POST", body: JSON.stringify({ password, confirmation }) },
        scope,
      );
      if (!isAuthScopeCurrent(scope)) return;
      setPassword("");
      setConfirmation("");
      setReview(false);
      await query.refetch();
    } catch (e) {
      if (isAuthScopeCurrent(scope))
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isAuthScopeCurrent(scope)) setBusy(false);
    }
  };
  return (
    <GatePage title={c("Support and account", "Ayuda y cuenta")} back>
      <GateCard title="VNDRLY Gate" icon="help-circle">
        <GateRow
          label={c("Privacy Policy", "Política de privacidad")}
          onPress={() =>
            void Linking.openURL("https://vndrly.ai/legal/privacy")
          }
        />
        <GateRow
          label={c("Terms and conditions", "Términos y condiciones")}
          onPress={() => void Linking.openURL("https://vndrly.ai/legal/terms")}
        />
        <GateRow
          label="support@vndrly.ai"
          detail={c("Contact VNDRLY support", "Contactar a soporte")}
          onPress={() => void Linking.openURL("mailto:support@vndrly.ai")}
        />
      </GateCard>
      <GateCard
        title={c("Account deletion", "Eliminación de cuenta")}
        icon="user-x"
      >
        <GateError
          message={error || query.error?.message}
          retry={() => void query.refetch()}
        />
        {query.data?.request ? (
          <>
            <Text style={gateStyle.text}>
              {c(
                "Your deletion request is saved and awaiting processing. This is not confirmation that your data has been deleted.",
                "Tu solicitud está guardada y pendiente de procesamiento. Esto no confirma que tus datos hayan sido eliminados.",
              )}
            </Text>
            <Text style={gateStyle.muted}>
              {query.data.request.id +
                " · " +
                new Date(query.data.request.requestedAt).toLocaleString()}
            </Text>
          </>
        ) : (
          <>
            <Text style={gateStyle.muted}>
              {c(
                "Request deletion of your VNDRLY account and associated personal data. Company operational records may require retention. The request goes directly to platform administration; no email or phone call is required to submit it.",
                "Solicita eliminar tu cuenta y datos personales. Los registros operativos de empresa pueden requerir conservación. La solicitud va directamente a la administración; no necesitas correo ni llamada para enviarla.",
              )}
            </Text>
            {review ? (
              <>
                <GateField
                  label={c("Current password", "Contraseña actual")}
                  value={password}
                  secureTextEntry
                  onChangeText={setPassword}
                />
                <GateField
                  label={c(
                    "Type DELETE to confirm",
                    "Escribe DELETE para confirmar",
                  )}
                  value={confirmation}
                  autoCapitalize="characters"
                  onChangeText={setConfirmation}
                />
                <TogglePillButton
                  color="red"
                  disabled={
                    busy ||
                    confirmation !== "DELETE" ||
                    !password ||
                    !query.isSuccess
                  }
                  loading={busy}
                  onPress={() => void submit()}
                >
                  {c(
                    "Submit deletion request",
                    "Enviar solicitud de eliminación",
                  )}
                </TogglePillButton>
                <TogglePillButton
                  disabled={busy}
                  onPress={() => {
                    setReview(false);
                    setPassword("");
                    setConfirmation("");
                  }}
                >
                  {c("Cancel", "Cancelar")}
                </TogglePillButton>
              </>
            ) : (
              <GateRow
                label={c(
                  "Request account deletion",
                  "Solicitar eliminación de cuenta",
                )}
                onPress={() => setReview(true)}
              />
            )}
          </>
        )}
      </GateCard>
      {user?.role === "admin" && (
        <GateCard
          title={c("Account deletion requests", "Solicitudes de eliminación")}
          icon="inbox"
        >
          <GateError
            message={queue.error?.message}
            retry={() => void queue.refetch()}
          />
          {queue.data?.requests.map((r) => (
            <Text key={r.user_id} style={gateStyle.text}>
              {r.display_name +
                " · " +
                r.email +
                " · " +
                new Date(r.request.requestedAt).toLocaleString() +
                " · " +
                r.request.status}
            </Text>
          ))}
          {queue.isSuccess && !queue.data?.requests.length && (
            <Text style={gateStyle.muted}>
              {c("No pending requests.", "Sin solicitudes pendientes.")}
            </Text>
          )}
        </GateCard>
      )}
    </GatePage>
  );
}
