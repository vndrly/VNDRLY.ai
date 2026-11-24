import { ModalPressable as Pressable } from "@/components/ModalDraft";
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useBrand } from "@/hooks/use-brand";
import NotificationBell from "@/components/NotificationBell";
import AskVNavLogo from "@/components/AskVNavLogo";
import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";

export type HeaderState = { enabled: boolean; count: number; open: boolean; pending?: boolean; error?: boolean };
const empty: HeaderState = { enabled: false, count: 0, open: false };
const Context = createContext<{
  state: HeaderState;
  setMapFullscreen: (expanded: boolean) => void;
  update: (state: HeaderState) => void;
  register: (open: (mode?: "askv") => void) => () => void;
  toggle: () => void;
  showAskV: () => void;
  sharedCompanion: boolean;
} | null>(null);
export const useGateHeaderActions = () => useContext(Context);

export function GateHeaderActionsProvider({ children, onMapFullscreenChange = () => {} }: { children: React.ReactNode; onMapFullscreenChange?: (expanded: boolean) => void }) {
  const [state, update] = useState(empty);
  const action = useRef<((mode?: "askv") => void) | null>(null);
  const [sharedCompanion, setSharedCompanion] = useState(false);
  const register = useCallback((open: (mode?: "askv") => void) => {
    setSharedCompanion(true);
    action.current = open;
    return () => { if (action.current === open) { action.current = null; update(empty); setSharedCompanion(false); } };
  }, []);
  const toggle = useCallback(() => action.current?.(), []);
  const showAskV = useCallback(() => action.current?.("askv"), []);
  const value = useMemo(() => ({ state, update, register, toggle, showAskV, sharedCompanion, setMapFullscreen: onMapFullscreenChange }), [state, register, toggle, showAskV, sharedCompanion, onMapFullscreenChange]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export default function GateHeaderActions({ count, onNotifications }: { count: number; onNotifications?: () => void }) {
  const header = useGateHeaderActions();
  const brand = useBrand();
  const voice = useAskVVoiceSession();
  const active = !voice.muted && ["connecting", "greeting", "listening", "thinking", "speaking", "wake-idle"].includes(voice.state);
  return <View testID="gate-header-actions" style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 4 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={active ? "Stop AskV" : "Start AskV"}
      accessibilityState={{ selected: active }} onPress={() => { voice.setMuted(active); if (!active) void voice.startConversation(); }} testID="gate-header-askv"
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
      <AskVNavLogo active={active} size={40} />
      <Text style={{ fontSize: 9, color: brand.primary }}>{voice.state === "error" ? "Retry" : active ? voice.state : "Stopped"}</Text>
    </Pressable>
    {header?.state.enabled && <Pressable accessibilityRole="button" accessibilityLabel="Next Steps"
      accessibilityState={{ expanded: header.state.open }} onPress={header.toggle} testID="gate-header-next-steps"
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
      <Feather name="list" size={25} color={brand.primary} />
      <Text style={{ position: "absolute", right: 0, top: 0, color: brand.primary, fontSize: 11, borderWidth: 1, borderColor: brand.primary, borderRadius: 4, paddingHorizontal: 3 }}>{header.state.pending ? "…" : header.state.error ? "?" : header.state.count}</Text>
    </Pressable>}
    <NotificationBell count={count} onPress={onNotifications} />
  </View>;
}
