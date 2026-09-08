import { Feather } from "@expo/vector-icons";
import { Stack, router } from "expo-router";
import React from "react";
import { Pressable, Text } from "react-native";
import { useColors } from "@/hooks/useColors";
import { workHubExitRoute } from "@/lib/work-hub-navigation";
export default function WorkHubLayout() { const colors = useColors(); return <Stack screenOptions={{ headerStyle: { backgroundColor: colors.card }, headerTintColor: colors.text, headerTitleStyle: { fontWeight: "700" }, headerLeft: () => <Pressable accessibilityRole="button" accessibilityLabel="Back to VNDRLY" onPress={() => router.replace(workHubExitRoute() as never)} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6 }}><Feather name="arrow-left" size={18} color={colors.primary}/><Text style={{ color: colors.primary, fontWeight: "700" }}>VNDRLY</Text></Pressable> }}><Stack.Screen name="index" options={{ title: "Work Hub" }}/><Stack.Screen name="[module]"/></Stack>; }
