import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useColors } from "@/hooks/useColors";
import MapboxNativeMap, { type NativeMapCircle, type NativeMapLine, type NativeMapPoint } from "../MapboxNativeMap";
import GateMapPinDetailNative, { type GateMapPinDetail } from "./GateMapPinDetailNative";
import GateMapEquipmentDetailNative, { type GateMapEquipmentDetail } from "./GateMapEquipmentDetailNative";

export type GateMapCanvas = {
  points: NativeMapPoint[];
  fitPoints: NativeMapPoint[];
  lines: NativeMapLine[];
  circles: NativeMapCircle[];
  accessToken: string;
  center: [number, number] | null;
  selectedPointId: string;
  styleKind: "street" | "satellite" | "dark";
  cameraRevision: number;
  expanded: boolean;
  instant: boolean;
  showLinks: boolean;
  showSiteLocations: boolean;
  staffVisible: boolean;
  equipmentVisible: boolean;
  settingsOpen: boolean;
  revealOpen: boolean;
  equipmentOpen: boolean;
  droppingGate: boolean;
  droppingPin: boolean;
  movingPointId: string;
  managementAllowed: boolean;
  siteAvailable: boolean;
  es: boolean;
  menu: { id: string; label: string; kind: "summary" | "button" | "text"; disabled: boolean; depth: number }[];
  pinDetail?: GateMapPinDetail | null;
  equipmentDetail?: GateMapEquipmentDetail | null;
};

type Props = {
  data: GateMapCanvas;
  height: number;
  onMapAction: (action: "point" | "tap" | "drag" | "longpress", id?: string, latitude?: number, longitude?: number) => void;
  onControl: (control: string) => void;
  onMenu: (id: string) => void;
  onPinDetail: (action: "close" | "edit" | "move" | "remove", pinId: string) => void;
  onEquipmentDetail: (action: "close" | "open", equipmentId: string) => void;
};

export default function GateMapCanvasNative({ data, height, onMapAction, onControl, onMenu, onPinDetail, onEquipmentDetail }: Props) {
  const colors = useColors();
  const primary = colors.primary;
  const [zoomCommand, setZoomCommand] = useState({ sequence: 0, delta: 0 });
  const [anchor, setAnchor] = useState<[number, number] | null>(null);
  const [mapWidth, setMapWidth] = useState(0);
  useEffect(() => setAnchor(null), [data.pinDetail?.id, data.equipmentDetail?.id]);
  const detailCoordinate = data.pinDetail ? [data.pinDetail.longitude,data.pinDetail.latitude] as [number,number] : data.equipmentDetail ? [data.equipmentDetail.longitude,data.equipmentDetail.latitude] as [number,number] : undefined;
  const pressControl = (name: string) => {
    if (name === "zoom-in" || name === "zoom-out") setZoomCommand(current => ({ sequence: current.sequence + 1, delta: name === "zoom-in" ? 1 : -1 }));
    else onControl(name);
  };
  const control = (name: string, icon: React.ComponentProps<typeof Feather>["name"], label: string, selected = false) => <Pressable
    key={name} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={() => pressControl(name)}
    style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: selected ? "#173d46" : "#25282b" }}><Feather name={icon} size={18} color={selected ? primary : "#e7e7e7"} /></Pressable>;
  const menu = data.settingsOpen || data.revealOpen || data.equipmentOpen;
  return <View accessibilityLabel="Gate coverage map" onLayout={event => setMapWidth(event.nativeEvent.layout.width)} style={{ height, minHeight: 180, borderRadius: 12, borderWidth: 2, borderColor: primary, overflow: "hidden", backgroundColor: "#242628" }}>
    <MapboxNativeMap height="100%" points={data.points} fitPoints={data.fitPoints} lines={data.lines} circles={data.circles} accessToken={data.accessToken} center={data.center ?? undefined}
      selectedPointId={data.selectedPointId} styleKind={data.styleKind} zoom={data.center ? 16 : 14} viewKey={String(data.cameraRevision)}
      draggablePointId={data.movingPointId || undefined} onPointPress={id => onMapAction("point", id)} onMapPress={(lat, lng) => onMapAction("tap", undefined, lat, lng)}
      onMapLongPress={(lat, lng) => onMapAction("longpress", undefined, lat, lng)} onPointDragEnd={(id, lat, lng) => onMapAction("drag", id, lat, lng)} controls showControls={false} zoomCommand={zoomCommand}
      anchorCoordinate={detailCoordinate} onAnchorPosition={(x,y) => setAnchor([x,y])} />
    {data.pinDetail && anchor && mapWidth > 0 && <GateMapPinDetailNative key={data.pinDetail.id} pin={data.pinDetail} x={anchor[0]} y={anchor[1]} mapWidth={mapWidth} mapHeight={height} onAction={action => onPinDetail(action,data.pinDetail!.id)} />}
    {data.equipmentDetail && anchor && mapWidth > 0 && <GateMapEquipmentDetailNative key={data.equipmentDetail.id} detail={data.equipmentDetail} x={anchor[0]} y={anchor[1]} mapWidth={mapWidth} mapHeight={height} onAction={action => onEquipmentDetail(action,data.equipmentDetail!.id)} />}
    <View style={{ position: "absolute", top: 8, right: 8, flexDirection: "row", gap: 4 }}>
      {control("zoom-in", "plus", data.es ? "Acercar" : "Zoom in")}{control("zoom-out", "minus", data.es ? "Alejar" : "Zoom out")}
    </View>
    {menu && <View style={{ position: "absolute", top: 50, left: 8, width: 265, maxHeight: Math.max(120, height - 115), borderWidth: 1, borderColor: primary, borderRadius: 8, backgroundColor: "#222426" }}>
      {data.settingsOpen ? <View style={{ padding: 8, gap: 6 }}>
        {[["links",data.es?"Vínculos":"Links",data.showLinks],["sites",data.es?"Ubicaciones de sitios":"Site Locations",data.showSiteLocations],["style",data.styleKind === "satellite" ? "Satellite" : "Street",data.styleKind === "satellite"],["dark",data.es?"Modo oscuro":"Dark Mode",data.styleKind === "dark"]].map(([key,label,active]) => <Pressable key={String(key)} accessibilityRole="switch" accessibilityState={{ checked: Boolean(active) }} onPress={() => onControl(String(key))} style={{ flexDirection: "row", justifyContent: "space-between", padding: 7 }}><Text style={{ color: "#eee", fontSize: 13 }}>{label}</Text><Text style={{ color: active ? primary : "#999" }}>{active ? "●" : "○"}</Text></Pressable>)}
      </View> : <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="always" style={{ maxHeight: Math.max(120, height - 115) }} contentContainerStyle={{ padding: 7 }}>
        {data.menu.map(item => item.kind === "text" ? <Text key={item.id} style={{ color: "#aaa", fontSize: 12, padding: 5, paddingLeft: 5 + item.depth * 10 }}>{item.label}</Text> : <Pressable key={item.id} accessibilityRole="button" disabled={item.disabled} onPress={() => onMenu(item.id)} style={{ paddingVertical: 7, paddingHorizontal: 5, paddingLeft: 5 + item.depth * 10, borderBottomWidth: 1, borderBottomColor: "#393b3d" }}><Text style={{ color: item.disabled ? "#777" : "#e8e8e8", fontSize: 13 }}>{item.label}</Text></Pressable>)}
      </ScrollView>}
    </View>}
    <View style={{ position: "absolute", bottom: 8, left: 8, right: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <View style={{ flexDirection: "row", gap: 4 }}>{control("settings", "settings", data.es ? "Configuración del mapa" : "Map settings", data.settingsOpen)}{control("staff", "users", data.es ? "Mostrar personal" : "Reveal Staff", data.revealOpen)}{control("equipment", "package", data.es ? "Mostrar equipos" : "Reveal Equipment", data.equipmentOpen)}</View>
      <View style={{ flexDirection: "row", gap: 4 }}>{!data.instant && data.managementAllowed && control("drop-gate", "map-pin", data.es ? "Colocar acceso" : "Drop Gate", data.droppingGate)}{control("center", "crosshair", data.es ? "Centrar en mí" : "Center on Me")}{!data.instant && data.siteAvailable && control("drop-pin", "navigation", data.es ? "Agregar pin" : "Drop Pin", data.droppingPin)}</View>
      <View style={{ flexDirection: "row", gap: 4 }}>{control("expand", data.expanded ? "minimize-2" : "maximize-2", data.expanded ? "Close map" : "Expand map", data.expanded)}{control("fit", "maximize", data.es ? "Ajustar" : "Fit map")}</View>
    </View>
  </View>;
}
