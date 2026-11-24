import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import * as Crypto from "expo-crypto";
import { changeOverRequest } from "@/lib/change-over-api";
import type { ChangeOverState } from "@workspace/gate-booth";
import GateDashboardHandoffCard from "./GateDashboardHandoffCard";

export function GateDashboardHandoffPending({ phase }: { phase: "pending" | "error" }) {
  const { i18n } = useTranslation();
  const { primary } = useColors();
  const es = (i18n.language ?? "en").startsWith("es");
  return <View accessibilityLabel={es ? "Relevo del turno" : "Shift handoff"} style={{ backgroundColor: "#242426", borderColor: primary, borderWidth: 2, borderRadius: 14, padding: 16, gap: 9 }}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 9 }}><Feather name="clipboard" size={20} color={primary} /><View style={{ flex: 1 }}><Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 17, fontWeight: "700" }}>{es ? "Relevo del turno" : "Shift handoff"}</Text><Text style={{ color: "#b3b3b3", fontSize: 12 }}>{es ? "Deja un informe claro para el próximo operador." : "Leave the next operator a clear watch brief."}</Text></View></View>
    <Text accessibilityRole={phase === "error" ? "alert" : undefined} style={{ color: "#b3b3b3", fontSize: 13 }}>{phase === "error" ? es ? "No se pudieron cargar los detalles del relevo." : "Handoff details could not be loaded." : es ? "Cargando detalles del relevo…" : "Loading handoff details…"}</Text>
  </View>;
}

export default function GateDashboardHandoffNative({ stationId, current, gatekeeperOnDuty, online, readError, pendingWatch, onWebAction, onChanged }: {
  stationId: string;
  current: ChangeOverState;
  gatekeeperOnDuty: boolean;
  online: boolean;
  readError: boolean;
  pendingWatch: boolean;
  onWebAction: (action: "assume" | "recover") => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const cache = useQueryClient();
  const [notes, setNotes] = useState(current.preparation?.notes ?? "");
  const [itemText, setItemText] = useState("");
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ownWatch = current.shift?.operator_id === user?.id;
  useEffect(() => { setNotes(current.preparation?.notes ?? ""); }, [current.shift?.id, current.preparation?.id]);
  const run = async (action: () => Promise<unknown>) => {
    if (busy) throw new Error("Another handoff action is in progress.");
    setBusy(true); setError("");
    try {
      await action();
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["gate-watch-timeline"] }),
        cache.invalidateQueries({ queryKey: ["change-over-state"] }),
      ]);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The handoff action could not be confirmed.");
      throw cause;
    } finally { setBusy(false); }
  };
  const mutate = (path: string, body: unknown) => changeOverRequest(`/${stationId}/${path}`, body);
  return <View><GateDashboardHandoffCard
    stationId={stationId}
    current={current}
    ownWatch={ownWatch}
    gatekeeperOnDuty={gatekeeperOnDuty}
    busy={busy}
    online={online}
    readError={readError}
    notes={notes}
    onNotesChange={setNotes}
    itemText={itemText}
    onItemTextChange={setItemText}
    itemNotes={itemNotes}
    onItemNoteChange={(id, text) => setItemNotes(value => ({ ...value, [id]: text }))}
    onItemAction={(id, kind) => void run(async () => {
      await mutate("items", { itemId: id, kind, text: itemNotes[id]?.trim() ?? "" });
      setItemNotes(value => ({ ...value, [id]: "" }));
    }).catch(() => undefined)}
    onAddItem={() => void run(async () => {
      await mutate("items", { itemId: Crypto.randomUUID(), kind: "open", text: itemText });
      setItemText("");
    }).catch(() => undefined)}
    onSave={() => void run(() => mutate("prepare", { notes })).catch(() => undefined)}
    onEditSave={async text => { await run(() => mutate("prepare", { notes: text })); }}
    onSignHandoff={async input => { await run(() => changeOverRequest(`/${stationId}/handoff/sign`, input)); }}
    onAddNote={async input => { await run(() => changeOverRequest(`/${stationId}/notes/add`, input)); }}
    onAssumeReviewed={() => onWebAction("assume")}
    pendingWatch={pendingWatch}
    onRecoverWatch={() => onWebAction("recover")}
  />{!!error && <Text accessibilityRole="alert" style={{ color: "#f87171", padding: 8 }}>{error}</Text>}</View>;
}
