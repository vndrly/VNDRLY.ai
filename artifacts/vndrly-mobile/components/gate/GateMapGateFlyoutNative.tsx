import React from "react";
import { View } from "react-native";
import DismissibleModal from "@/components/DismissibleModal";
import GateDashboardAdminDialogNative, { type AdminDialog } from "./GateDashboardAdminDialogNative";

export default function GateMapGateFlyoutNative({ dialog, onAction, onClose }: {
  dialog: AdminDialog;
  onAction: (id: string, action: "press" | "change", value?: string) => void;
  onClose: () => void;
}) {
  return <DismissibleModal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={{ flex: 1 }}><GateDashboardAdminDialogNative dialog={dialog} onAction={onAction} /></View>
  </DismissibleModal>;
}
