import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { apiFetch, getApiBase } from "@/lib/api";
import { useColors } from "@/hooks/useColors";
import TogglePillButton from "@/components/TogglePillButton";

type Packet = {
  revision: number;
  jobId: number | null;
  afe: string | null;
  submittedAt: string;
  ticket: Record<string, unknown>;
  lineItems: Array<Record<string, unknown>>;
  notes: Array<{ id: number; content: string; attachments?: string[] }>;
  checkIns: Array<Record<string, unknown>>;
  gate: {
    period?: {
      days?: Array<{
        day: string;
        chargeCents: number;
        hasCoverageGap: boolean;
      }>;
    };
  } | null;
};
type Proof = {
  jobId: number | null;
  revision: number;
  approvedRevision: number | null;
  submissions: Packet[];
};
const spanish: Record<string, string> = {
  "Submitted proof sheet": "Hoja de comprobación enviada",
  Job: "Trabajo",
  Revision: "Revisión",
  "Refresh proof sheet": "Actualizar hoja de comprobación",
  "Approve this revision": "Aprobar esta revisión",
  "Return for correction": "Devolver para corrección",
  "Reason for correction": "Motivo de corrección",
  "I reviewed this submitted revision.": "Revisé esta versión enviada.",
  "Proof sheet could not be loaded. Refresh before reviewing.":
    "No se pudo cargar la hoja. Actualice antes de revisarla.",
  "The review could not be saved. Refresh the proof sheet before trying again.":
    "No se pudo guardar la revisión. Actualice la hoja antes de intentarlo de nuevo.",
  Submitted: "Enviado",
  "Approved revision": "Revisión aprobada",
  Attachment: "Archivo adjunto",
  "Coverage gap acknowledged": "Brecha de cobertura reconocida",
  "Reject submitted work": "Rechazar trabajo presentado",
  "Check-in": "Entrada",
  "Check-out": "Salida",
  "Historical ticket: no saved submission revision.":
    "Ticket histórico: no hay versión de envío guardada.",
};

/** Review always acts on the revision displayed here, never a version fetched at click time. */
export default function TicketSubmittedProof({
  ticketId,
  status,
  role,
  onChanged,
}: {
  ticketId: number;
  status: string;
  role: string;
  onChanged: () => void;
}) {
  const colors = useColors(),
    { i18n } = useTranslation();
  const copy = (s: string) =>
    i18n.language.startsWith("es") ? (spanish[s] ?? s) : s;
  const [proof, setProof] = useState<Proof | null>(null),
    [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [reason, setReason] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setReviewed(false);
    setError("");
    try {
      setProof(
        await apiFetch<Proof>(`/api/tickets/${ticketId}/proof-submissions`),
      );
    } catch {
      setProof(null);
      setError("Proof sheet could not be loaded. Refresh before reviewing.");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);
  useEffect(() => {
    void load();
  }, [load]);
  const packet = proof?.submissions?.find((p) => p.revision === proof.revision);
  const canReview =
    ["partner", "admin"].includes(role) &&
    ["submitted", "pending_review", "completed"].includes(status);
  const act = async (action: "approve" | "kickback" | "reject-submission") => {
    if (!packet || !reviewed || busy || loading) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/api/tickets/${ticketId}/${action}`, {
        method: "POST",
        headers: { "X-Submission-Revision": String(packet.revision) },
        ...(action !== "approve"
          ? { body: JSON.stringify({ reason: reason.trim() }) }
          : {}),
      });
      setReviewed(false);
      onChanged();
      await load();
    } catch {
      setReviewed(false);
      setError(
        "The review could not be saved. Refresh the proof sheet before trying again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const text = { color: colors.foreground };
  return (
    <View
      testID="submitted-proof-sheet"
      style={{
        padding: 16,
        gap: 10,
        borderWidth: 1,
        borderColor: colors.primary,
        backgroundColor: colors.card,
        borderRadius: 12,
      }}
    >
      <Text style={[text, { fontWeight: "700" }]}>
        {copy("Submitted proof sheet")}
      </Text>
      {loading ? <ActivityIndicator /> : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {copy(error)}
        </Text>
      ) : null}
      {packet ? (
        <>
          <Text style={text}>
            {copy("Job")}: {packet.jobId ? `#${packet.jobId}` : "—"} · AFE:{" "}
            {packet.afe || "—"}
          </Text>
          <Text style={text}>
            {copy("Revision")}: {packet.revision} · {copy("Submitted")}:{" "}
            {packet.submittedAt}
          </Text>
          {proof?.approvedRevision ? (
            <Text style={text}>
              {copy("Approved revision")}: {proof.approvedRevision}
            </Text>
          ) : null}
          <Text style={text}>{String(packet.ticket.description ?? "")}</Text>
          {packet.ticket.notes ? (
            <Text style={text}>{String(packet.ticket.notes)}</Text>
          ) : null}
          <Text style={text}>
            {copy("Check-in")}: {String(packet.ticket.check_in_time ?? "—")} ·{" "}
            {copy("Check-out")}: {String(packet.ticket.check_out_time ?? "—")}
          </Text>
          {packet.lineItems.map((line, index) => (
            <Text key={String(line.id ?? index)} style={text}>
              {String(line.description ?? "")} · {String(line.quantity ?? "")} ×{" "}
              {String(line.unit_price ?? "")}
            </Text>
          ))}
          {packet.notes.map((note) => (
            <View key={note.id} style={{ gap: 6 }}>
              <Text style={text}>{note.content}</Text>
              {[...(note.attachments ?? []), ...(note.content.startsWith("[photo] ") ? [note.content.slice(8).trim()] : [])].map((attachment, index) => (
                <Text
                  key={`${index}:${attachment}`}
                  accessibilityRole="link"
                  style={{ color: colors.primary }}
                  onPress={() => {
                    const url = attachment.startsWith("/")
                      ? `${getApiBase()}${attachment}`
                      : attachment;
                    if (/^https?:\/\//.test(url))
                      void Linking.openURL(url).catch(() => {});
                  }}
                >
                  {copy("Attachment")} {index + 1}: {attachment}
                </Text>
              ))}
            </View>
          ))}
          {packet.gate?.period?.days?.map((day) => (
            <Text key={day.day} style={text}>
              {day.day} · USD {(day.chargeCents / 100).toFixed(2)}
              {day.hasCoverageGap
                ? ` · ${copy("Coverage gap acknowledged")}`
                : ""}
            </Text>
          ))}
          {canReview ? (
            <>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Switch
                  accessibilityLabel={copy(
                    "I reviewed this submitted revision.",
                  )}
                  value={reviewed}
                  onValueChange={setReviewed}
                  disabled={busy || loading}
                />
                <Text style={text}>
                  {copy("I reviewed this submitted revision.")}
                </Text>
              </View>
              <TogglePillButton
                color="green"
                disabled={!reviewed || busy || loading}
                onPress={() => void act("approve")}
              >
                {copy("Approve this revision")}
              </TogglePillButton>
              <TextInput
                accessibilityLabel={copy("Reason for correction")}
                placeholder={copy("Reason for correction")}
                value={reason}
                onChangeText={setReason}
                editable={!busy}
                style={{
                  color: colors.foreground,
                  borderWidth: 1,
                  borderColor: colors.primary,
                  padding: 10,
                }}
              />
              <TogglePillButton
                disabled={!reviewed || !reason.trim() || busy || loading}
                onPress={() => void act("kickback")}
              >
                {copy("Return for correction")}
              </TogglePillButton>
              <TogglePillButton color="red" disabled={!reviewed || !reason.trim() || busy || loading} onPress={() => void act("reject-submission")}>{copy("Reject submitted work")}</TogglePillButton>
            </>
          ) : null}
        </>
      ) : !loading && proof ? (
        <Text style={text}>
          {copy("Historical ticket: no saved submission revision.")}
        </Text>
      ) : null}
      <TogglePillButton disabled={busy || loading} onPress={() => void load()}>
        {copy("Refresh proof sheet")}
      </TogglePillButton>
    </View>
  );
}
