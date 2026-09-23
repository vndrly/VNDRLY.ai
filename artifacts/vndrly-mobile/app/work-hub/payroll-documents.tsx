import React from "react";
import { ScrollView } from "react-native";
import { Stack } from "expo-router";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPayrollDocuments from "@/components/WorkHubPayrollDocuments";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import { useColors } from "@/hooks/useColors";
export default function PayrollDocumentsScreen() {
  const colors = useColors();
  return <ScreenSafeArea style={{ backgroundColor: colors.background }}><Stack.Screen options={{ title: "My payroll documents" }} /><ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}><WorkHubPageTitle title="My payroll documents" /><WorkHubPayrollDocuments /></ScrollView></ScreenSafeArea>;
}
