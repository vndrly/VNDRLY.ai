import React from "react";
import { ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import NativeOperations from "@/components/work-hub/NativeOperations";
export default function NativeOperationsScreen() {
  const { requestId, action, systemRequestId } = useLocalSearchParams<{ requestId?: string; action?: string; systemRequestId?: string }>();
  return <ScreenSafeArea><ScrollView contentContainerStyle={{ padding: 20 }}><NativeOperations requestId={requestId} action={action} systemRequestId={systemRequestId} /></ScrollView></ScreenSafeArea>;
}
