import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useBrand } from "@/hooks/use-brand";
import NotificationBell from "@/components/NotificationBell";

type HeaderState = { enabled: boolean; count: number; open: boolean; pending?: boolean; error?: boolean };
const empty: HeaderState = { enabled: false, count: 0, open: false };
const Context = createContext<{
  state: HeaderState;
  update: (state: HeaderState) => void;
  register: (open: () => void) => () => void;
  toggle: () => void;
} | null>(null);
export const useGateHeaderActions = () => useContext(Context);

export function GateHeaderActionsProvider({ children }: { children: React.ReactNode }) {
  const [state, update] = useState(empty);
  const action = useRef<(() => void) | null>(null);
  const register = useCallback((open: () => void) => {
    action.current = open;
    return () => { if (action.current === open) { action.current = null; update(empty); } };
  }, []);
  const toggle = useCallback(() => action.current?.(), []);
  const value = useMemo(() => ({ state, update, register, toggle }), [state, register, toggle]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export default function GateHeaderActions({ count, onNotifications }: { count: number; onNotifications?: () => void }) {
  const header = useGateHeaderActions();
  const brand = useBrand();
  return <View testID="gate-header-actions" style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 4 }}>
    {header?.state.enabled && <Pressable accessibilityRole="button" accessibilityLabel="Next Steps"
      accessibilityState={{ expanded: header.state.open }} onPress={header.toggle} testID="gate-header-next-steps"
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
      <Feather name="list" size={25} color={brand.primary} />
      <Text style={{ position: "absolute", right: 0, top: 0, color: brand.primary, fontSize: 11, borderWidth: 1, borderColor: brand.primary, borderRadius: 4, paddingHorizontal: 3 }}>{header.state.pending ? "…" : header.state.error ? "?" : header.state.count}</Text>
    </Pressable>}
    <NotificationBell count={count} onPress={onNotifications} />
  </View>;
}
