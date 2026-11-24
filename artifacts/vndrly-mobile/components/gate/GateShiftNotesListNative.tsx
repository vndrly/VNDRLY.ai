import React, { useEffect, useState } from "react";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { changeOverRequest } from "@/lib/change-over-api";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import TogglePillButton from "@/components/TogglePillButton";
import type { ShiftNote, ShiftNotesResponse } from "@workspace/gate-booth";
import GateShiftNoteNativeCard from "./GateShiftNoteNativeCard";
import GateShiftNotesHeaderNative from "./GateShiftNotesHeaderNative";
import type { GateLogExportFilters } from "./GateLogExportNative";

export type GateShiftNotesGate = { id: string; name: string; siteId: number; siteName: string };
const dateLabel = (value: string, es: boolean) => new Intl.DateTimeFormat(es ? "es-US" : "en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) + " CT";

function Note({ note, gate, es }: { note: ShiftNote; gate: GateShiftNotesGate; es: boolean }) {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [viewed, setViewed] = useState(Boolean(note.viewed_at));
  const date = note.filed_at ?? note.created_at ?? note.acknowledged_at;
  const toggle = () => {
    setOpen(value => !value);
    if (open || viewed) return;
    setViewed(true);
    void changeOverRequest(`/${gate.id}/notes/${note.id}/viewed`, {}).then(() => cache.invalidateQueries({ queryKey: ["gate-shift-notes-by-gate"] })).catch(() => setViewed(false));
  };
  return <View style={{ borderTopWidth: 1, borderTopColor: "#3a3a3a" }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={toggle} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7 }}>
      <View style={{ flex: 1, minWidth: 0 }}><Text style={{ color: "#f4f4f4", fontSize: 14, fontWeight: "700" }}>{dateLabel(date, es)}</Text><Text style={{ color: "#b3b3b3", fontSize: 12 }}>{note.station_name ? `${note.station_name} · ` : ""}{note.outgoing_name} → {note.incoming_name}</Text></View>
      <Feather name={open ? "chevron-down" : "chevron-right"} size={18} color="#b3b3b3" />
    </Pressable>
    {open && <View style={{ gap: 9, paddingBottom: 12 }}><GateShiftNoteNativeCard note={note} /><Pressable accessibilityRole="link" onPress={() => router.push(`/shift-notes?siteId=${gate.siteId}&stationId=${encodeURIComponent(gate.id)}&handoffId=${encodeURIComponent(note.id)}` as never)}><Text style={{ color: "#08b5d5", fontSize: 13, textDecorationLine: "underline" }}>{es ? "Abrir registro completo del turno" : "Open full shift record"}</Text></Pressable></View>}
  </View>;
}

function Group({ gate, initialOpen, search, identity, es }: { gate: GateShiftNotesGate; initialOpen: boolean; search: string; identity: string; es: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  useEffect(() => { setOpen(initialOpen); }, [initialOpen]);
  const notes = useInfiniteQuery({
    queryKey: ["gate-shift-notes-by-gate", identity, gate.siteId, gate.id, search, 30],
    initialPageParam: null as { before: string; beforeId?: string } | null,
    queryFn: ({ pageParam }) => changeOverRequest<ShiftNotesResponse>(`/${gate.id}/notes?${new URLSearchParams({ days: "30", ...(search ? { search } : {}), ...(pageParam ?? {}) })}`),
    getNextPageParam: page => page.nextBefore ? { before: page.nextBefore, ...(page.nextBeforeId ? { beforeId: page.nextBeforeId } : {}) } : undefined,
    retry: false,
  });
  const rows = [...new Map((notes.data?.pages.flatMap(page => page.rows) ?? []).map(note => [note.id, note])).values()];
  return <View style={{ borderTopWidth: 1, borderTopColor: "#3a3a3a" }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Feather name="map-pin" size={18} color="#08b5d5" /><Text style={{ color: "#f4f4f4", fontSize: 14, flex: 1 }}>{gate.siteName} | {gate.name}</Text><Text style={{ color: "#b3b3b3" }}>{notes.isSuccess ? `${rows.length}${notes.hasNextPage ? "+" : ""}` : ""}</Text><Feather name={open ? "chevron-down" : "chevron-right"} size={18} color="#b3b3b3" />
    </Pressable>
    {open && <View style={{ paddingLeft: 16, gap: 8 }}>
      {notes.isPending && <Text style={{ color: "#b3b3b3" }}>{es ? "Cargando notas…" : "Loading notes…"}</Text>}
      {notes.isError && <Pressable accessibilityRole="button" onPress={() => void notes.refetch()}><Text accessibilityRole="alert" style={{ color: "#fca5a5" }}>{es ? "No se pudieron cargar las notas. Reintentar" : "Notes could not be loaded. Retry"}</Text></Pressable>}
      {notes.isSuccess && !rows.length && <Text style={{ color: "#b3b3b3" }}>{es ? "No hay notas de turno en los últimos 30 días." : "No shift notes in the last 30 days."}</Text>}
      {rows.map(note => <Note key={note.id} note={note} gate={gate} es={es} />)}
      {notes.hasNextPage && <TogglePillButton disabled={notes.isFetchingNextPage} onPress={() => void notes.fetchNextPage()}>{es ? "Cargar más de los últimos 30 días" : "Load more from the last 30 days"}</TogglePillButton>}
    </View>}
  </View>;
}

export default function GateShiftNotesListNative({ gates, sites, siteId, gateId, gateName, filters, search, loading, error, onSelect, onSearch }: {
  gates: GateShiftNotesGate[];
  sites: { id: number; name: string }[];
  siteId: number;
  gateId: string;
  gateName: string;
  filters: GateLogExportFilters | null;
  search: string;
  loading: boolean;
  error: boolean;
  onSelect: (gateId: string) => void;
  onSearch: (search: string) => void;
}) {
  const { i18n } = useTranslation();
  const { user, activeMembershipId } = useAuth();
  const { primary } = useColors();
  const viewport = useWindowDimensions();
  const es = i18n.language?.startsWith("es") ?? false;
  const identity = JSON.stringify([user?.id, activeMembershipId, user?.vendorId, user?.partnerId]);
  const shown = gateId ? gates.filter(gate => gate.id === gateId) : gates;
  return <View accessibilityLabel={es ? "Notas de turno" : "Shift Notes"} style={{ borderWidth: 2, borderColor: primary, borderRadius: 14, backgroundColor: "#242426", padding: 16, gap: 10 }}>
    <GateShiftNotesHeaderNative sites={sites} gates={gates} siteId={siteId} gateId={gateId} gateName={gateName} filters={filters} search={search} onSelect={onSelect} onSearch={onSearch} />
    {loading && <Text style={{ color: "#b3b3b3" }}>{es ? "Cargando accesos…" : "Loading gates…"}</Text>}
    {error && <Text accessibilityRole="alert" style={{ color: "#fca5a5" }}>{es ? "No se pudieron cargar los accesos autorizados." : "Authorized gates could not be loaded."}</Text>}
    {!loading && !error && !gates.length && <Text style={{ color: "#b3b3b3" }}>{es ? "No hay accesos autorizados." : "No authorized gates."}</Text>}
    <ScrollView style={{ maxHeight: Math.max(240, viewport.height - 260) }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
      {shown.map(gate => <Group key={`${identity}:${gate.id}`} gate={gate} initialOpen={gate.id === gateId} search={search} identity={identity} es={es} />)}
    </ScrollView>
  </View>;
}
