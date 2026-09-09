import React from "react";
import { ScrollView, Text } from "react-native";
import { Stack } from "expo-router";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPayrollDocuments from "@/components/WorkHubPayrollDocuments";
import { useColors } from "@/hooks/useColors";
export default function PayrollDocumentsScreen() {
  const colors = useColors();
  return <ScreenSafeArea style={{ backgroundColor: colors.background }}><Stack.Screen options={{ title: "My payroll documents" }} /><ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}><Text accessibilityRole="header" style={{ color: colors.text, fontSize: 26, fontWeight: "700" }}>My payroll documents</Text><WorkHubPayrollDocuments /></ScrollView></ScreenSafeArea>;
}
