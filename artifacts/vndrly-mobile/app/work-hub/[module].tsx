import { Stack, useLocalSearchParams } from "expo-router";
import React from "react";
import { Text, View } from "react-native";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import { useColors } from "@/hooks/useColors";
export default function WorkHubModuleScreen() { const colors = useColors(); const { module } = useLocalSearchParams<{ module: string }>(); const title = String(module ?? "work-hub").split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "); return <ScreenSafeArea style={{ backgroundColor: colors.background }}><Stack.Screen options={{ title }}/><View style={{ padding: 20 }}><Text accessibilityRole="header" style={{ color: colors.text, fontSize: 28, fontWeight: "700" }}>{title}</Text><Text style={{ color: colors.mutedForeground, marginTop: 10 }}>This module stays inside your current VNDRLY account and organization context.</Text></View></ScreenSafeArea>; }
