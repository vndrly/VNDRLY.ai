import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Feather } from "@expo/vector-icons";
import { ModalPressable as Pressable, ModalTextInput as TextInput } from "@/components/ModalDraft";
import { PlateStatePicker } from "../PlateStatePicker";
import { useColors } from "@/hooks/useColors";
import type { PlateStateCode } from "@workspace/plate-state";

export type GateEntryField = { id: string; label: string; value: string; placeholder: string; disabled: boolean; required: boolean; options?: { value: string; label: string; disabled: boolean }[] };
export type GateEntryCard = {
  title: string; switchLabel: string; checkInLabel: string; checkInDisabled: boolean; resetLabel: string; resetDisabled: boolean;
  platePhotoLabel: string; platePhotoDisabled: boolean; vehiclePhotoLabel: string; vehiclePhotoDisabled: boolean;
  plateState: string; preferredStates: string[]; plateStateError: string;
  fields: GateEntryField[]; memoryField: string; suggestions: { id: string; label: string; detail: string }[];
  arrival: { text: string[]; actions: string[] } | null; error: string; voice: { prompt: string; cancel: string; confirm: string; confirmDisabled: boolean } | null;
  previous: { text: string; action: string } | null; lastDriver: string; notices: string[]; siteLoading: boolean; es: boolean;
  recognition: { preview: string; width: number; height: number; guide: string; summary: string[]; cancel: string; cropLabel: string; disabled: boolean } | null;
};

function EntryTextField({ field, onChange, onFocus, suggestions, onPick }: { field: GateEntryField; onChange: (id: string, value: string) => void; onFocus: (id: string) => void; suggestions: GateEntryCard["suggestions"]; onPick: (id: string) => void }) {
  const { primary } = useColors();
  const [value, setValue] = useState(field.value);
  useEffect(() => setValue(field.value), [field.value]);
  return <View style={{ flex: 1, minWidth: 120, gap: 5 }}>
    {field.id !== "gate-vehicle-plate" && <Text style={{ color: "#eee", fontSize: 13, fontWeight: "500" }}>{field.label}{field.required && !field.label.includes("*") ? " *" : ""}</Text>}
    <TextInput accessibilityLabel={field.label} value={value} placeholder={field.placeholder} placeholderTextColor="#888" editable={!field.disabled} onFocus={() => onFocus(field.id)} onChangeText={next => { setValue(next); onChange(field.id, next); }} autoCapitalize={field.id === "gate-vehicle-plate" ? "characters" : "words"} multiline={field.id === "gate-notes"} numberOfLines={field.id === "gate-notes" ? 3 : 1} style={{ color: "#eee", borderColor: primary, borderWidth: 1, borderRadius: 7, minHeight: field.id === "gate-notes" ? 75 : 40, paddingHorizontal: 10, letterSpacing: field.id === "gate-vehicle-plate" ? 2 : 0, textAlignVertical: field.id === "gate-notes" ? "top" : "center" }} />
    {suggestions.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.label} onPress={() => onPick(item.id)} style={{ borderWidth: 1, borderColor: "#555", borderRadius: 5, padding: 7 }}><Text style={{ color: "#eee", fontSize: 13 }}>{item.label}</Text>{!!item.detail && <Text style={{ color: "#aaa", fontSize: 11 }}>{item.detail}</Text>}</Pressable>)}
  </View>;
}

function EntrySelect({ field, onChange }: { field: GateEntryField; onChange: (id: string, value: string) => void }) {
  const { primary } = useColors();
  const [open, setOpen] = useState(false);
  const selected = field.options?.find(option => option.value === field.value);
  return <View style={{ flex: 1, minWidth: 120, gap: 5 }}>
    <Text style={{ color: "#eee", fontSize: 13 }}>{field.label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={field.label} accessibilityState={{ expanded: open, disabled: field.disabled }} disabled={field.disabled} onPress={() => setOpen(value => !value)} style={{ borderColor: primary, borderWidth: 1, borderRadius: 7, minHeight: 40, paddingHorizontal: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><Text style={{ color: "#eee", fontSize: 13, flex: 1 }} numberOfLines={1}>{selected?.label ?? field.value}</Text><Feather name={open ? "chevron-up" : "chevron-down"} size={15} color={primary} /></Pressable>
    {open && field.options?.map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: field.value === option.value, disabled: option.disabled }} disabled={option.disabled} onPress={() => { setOpen(false); onChange(field.id, option.value); }} style={{ padding: 7, borderWidth: 1, borderColor: field.value === option.value ? primary : "#555", borderRadius: 5 }}><Text style={{ color: option.disabled ? "#888" : "#eee", fontSize: 13 }}>{option.label}</Text></Pressable>)}
  </View>;
}

export default function GateEntryNativeCard({ card, onAction, onChange, onFocus, onPick, onPlateState, onPhoto, onCrop }: { card: GateEntryCard; onAction: (action: string) => void; onChange: (id: string, value: string) => void; onFocus: (id: string) => void; onPick: (id: string) => void; onPlateState: (state: string) => void; onPhoto: (kind: "plate" | "vehicle", base64: string, mimeType: string) => void; onCrop: (box: {x:number;y:number;w:number;h:number}) => void }) {
  const { primary } = useColors();
  const [captureError, setCaptureError] = useState("");
  const [imageWidth, setImageWidth] = useState(280);
  const [box, setBox] = useState({x:0,y:0,w:1,h:1});
  const cropStart = useRef<{x:number;y:number}|null>(null);
  useEffect(() => setBox({x:0,y:0,w:1,h:1}), [card.recognition?.preview]);
  const imageHeight = Math.min(256, imageWidth * (card.recognition?.height && card.recognition?.width ? card.recognition.height/card.recognition.width : .7));
  const field = (id: string) => card.fields.find(item => item.id === id);
  const control = (label: string, action: string, disabled = false, icon?: React.ComponentProps<typeof Feather>["name"]) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={() => onAction(action)} style={{ minHeight: 38, borderWidth: 1, borderColor: primary, borderRadius: 7, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, opacity: disabled ? 0.45 : 1 }}><>{icon && <Feather name={icon} color={primary} size={15} />}<Text style={{ color: "#eee", fontSize: 12, fontWeight: "600" }}>{label}</Text></></Pressable>;
  const renderField = (id: string) => { const item = field(id); return item ? <EntryTextField key={id} field={item} onChange={onChange} onFocus={onFocus} suggestions={card.memoryField === ({"gate-vehicle-plate":"vehiclePlate","gate-first-name":"firstName","gate-last-name":"lastName","gate-company":"company"} as Record<string,string>)[id] ? card.suggestions : []} onPick={onPick} /> : null; };
  const renderSelect = (id: string) => { const item = field(id); return item ? <EntrySelect key={id} field={item} onChange={onChange} /> : null; };
  const capture = async (kind: "plate" | "vehicle") => {
    try {
      setCaptureError("");
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) { setCaptureError(card.es ? "Se necesita permiso de cámara." : "Camera permission is required."); return; }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.65, base64: true, allowsEditing: false });
      const asset = result.assets?.[0];
      if (!result.canceled && asset?.base64) onPhoto(kind, asset.base64, asset.mimeType === "image/png" ? "image/png" : "image/jpeg");
    } catch { setCaptureError(card.es ? "No se pudo capturar la foto." : "Photo capture failed."); }
  };
  return <View accessibilityLabel={card.title} pointerEvents="box-none" style={{ backgroundColor: "#242426", borderColor: primary, borderWidth: 2, borderRadius: 12, padding: 14, gap: 12 }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7 }}><Pressable accessibilityRole="button" accessibilityLabel={card.switchLabel} onPress={() => onAction("switch")}><Feather name="refresh-cw" color={primary} size={20} /></Pressable><Text accessibilityRole="header" style={{ color: "#eee", fontSize: 17, fontWeight: "700", flexGrow: 1 }}>{card.title}</Text>{control(card.checkInLabel,"checkin",card.checkInDisabled)}{control(card.resetLabel,"reset",card.resetDisabled)}</View>
    {card.arrival && <View style={{ borderColor: "#555", borderWidth: 1, borderRadius: 6, padding: 9, gap: 6 }}>{card.arrival.text.map((line,index) => <Text key={index} style={{ color: "#ddd", fontSize: 12 }}>{line}</Text>)}<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>{card.arrival.actions.map((label,index) => <View key={index}>{control(label,index === 0 ? "arrival-use" : "arrival-remove")}</View>)}</View></View>}
    {!!card.error && <Text accessibilityRole="alert" style={{ color: "#ff9292", fontSize: 13, borderColor: "#d66", borderWidth: 1, borderRadius: 6, padding: 8 }}>{card.error}</Text>}
    {card.voice && <View style={{ borderColor: primary, borderWidth: 1, borderRadius: 7, padding: 9, gap: 7 }}><Text style={{ color: "#eee", fontWeight: "600" }}>{card.voice.prompt}</Text><View style={{ flexDirection: "row", gap: 8 }}>{control(card.voice.cancel,"voice-cancel")}{control(card.voice.confirm,"voice-confirm",card.voice.confirmDisabled)}</View></View>}
    <Text style={{ color: "#eee", fontSize: 15, fontWeight: "700" }}>{field("gate-vehicle-plate")?.label} *</Text>
    <View style={{ flexDirection: "row", gap: 8 }}><Pressable accessibilityRole="button" accessibilityLabel={card.platePhotoLabel} disabled={card.platePhotoDisabled} onPress={() => void capture("plate")} style={{ flex: 1, minHeight: 39, borderColor: primary, borderWidth: 1, borderRadius: 7, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 5 }}><Feather name="camera" size={15} color={primary} /><Text style={{ color: "#eee", fontSize: 12 }}>{card.platePhotoLabel}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={card.vehiclePhotoLabel} disabled={card.vehiclePhotoDisabled} onPress={() => void capture("vehicle")} style={{ flex: 1, minHeight: 39, borderColor: primary, borderWidth: 1, borderRadius: 7, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 5 }}><Feather name="camera" size={15} color={primary} /><Text style={{ color: "#eee", fontSize: 12 }}>{card.vehiclePhotoLabel}</Text></Pressable></View>
    {!!captureError && <Text accessibilityRole="alert" style={{ color: "#ff9292" }}>{captureError}</Text>}
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>{renderField("gate-vehicle-plate")}<View style={{ flex: 1, minWidth: 120 }}><PlateStatePicker value={(card.plateState || null) as PlateStateCode | null} preferredStates={card.preferredStates} error={card.plateStateError || undefined} onChange={state => onPlateState(state)} /></View></View>
    <View style={{ flexDirection: "row", gap: 8 }}>{renderField("gate-first-name")}{renderField("gate-last-name")}</View>
    <View style={{ flexDirection: "row", gap: 8 }}>{renderField("gate-company")}{renderSelect("gate-expected-duration")}</View>
    {card.previous && <View style={{ borderWidth: 1, borderColor: "#555", borderRadius: 7, padding: 9, gap: 7 }}><Text style={{ color: "#eee", fontSize: 12 }}>{card.previous.text}</Text>{control(card.previous.action,"previous-use")}</View>}
    {!!card.lastDriver && <Text style={{ color: "#aaa", fontSize: 12 }}>{card.lastDriver}</Text>}
    {card.notices.map((notice,index) => <Text key={index} style={{ color: "#aaa", fontSize: 12 }}>{notice}</Text>)}
    {card.recognition && <View style={{ gap: 7, borderWidth: 1, borderColor: primary, borderRadius: 7, padding: 9 }}>
      {!!card.recognition.guide && <Text style={{ color: "#eee", fontSize: 12 }}>{card.recognition.guide}</Text>}
      {card.recognition.preview ? <View onLayout={event => setImageWidth(event.nativeEvent.layout.width)} onStartShouldSetResponder={() => !card.recognition?.disabled} onMoveShouldSetResponder={() => !card.recognition?.disabled}
        onResponderGrant={event => { const x=Math.max(0,Math.min(1,event.nativeEvent.locationX/imageWidth));const y=Math.max(0,Math.min(1,event.nativeEvent.locationY/imageHeight));cropStart.current={x,y};setBox({x,y,w:0,h:0}); }}
        onResponderMove={event => { if (!cropStart.current) return; const x=Math.max(0,Math.min(1,event.nativeEvent.locationX/imageWidth));const y=Math.max(0,Math.min(1,event.nativeEvent.locationY/imageHeight));setBox({x:Math.min(x,cropStart.current.x),y:Math.min(y,cropStart.current.y),w:Math.abs(x-cropStart.current.x),h:Math.abs(y-cropStart.current.y)}); }}
        onResponderRelease={() => { cropStart.current=null; }} style={{ width: "100%", height: imageHeight }}>
        <Image source={{uri:card.recognition.preview}} resizeMode="stretch" style={{width:"100%",height:imageHeight,borderRadius:5}} />
        <View pointerEvents="none" style={{ position:"absolute",left:`${box.x*100}%`,top:`${box.y*100}%`,width:`${box.w*100}%`,height:`${box.h*100}%`,borderColor:"#fbbf24",borderWidth:2 }} />
      </View> : <Text style={{ color: "#aaa" }}>{card.es ? "Cargando foto…" : "Loading photo…"}</Text>}
      <Text style={{ color: "#bbb", fontSize: 12 }}>{card.es ? "Recorte (porcentaje)" : "Crop controls (percent)"}</Text>
      <View style={{ flexDirection: "row", gap: 6 }}>{(["x","y","w","h"] as const).map((key,index) => <View key={key} style={{flex:1,gap:3}}><Text style={{color:"#bbb",fontSize:10}}>{(card.es?["Izq.","Arriba","Ancho","Alto"]:["Left","Top","Width","Height"])[index]}</Text><TextInput keyboardType="numeric" accessibilityLabel={key} value={String(Math.round(box[key]*100))} onChangeText={value => { const number=Number(value); if(!Number.isFinite(number))return;setBox(current=>{const next={...current,[key]:Math.max(0,Math.min(1,number/100))};next.w=Math.min(next.w,1-next.x);next.h=Math.min(next.h,1-next.y);return next;}); }} style={{color:"#eee",borderColor:primary,borderWidth:1,borderRadius:5,minHeight:32,textAlign:"center"}} /></View>)}</View>
      {card.recognition.summary.map((line,index) => <Text key={index} style={{color:"#ddd",fontSize:12}}>{line}</Text>)}
      <View style={{ flexDirection:"row",gap:7 }}>{control(card.recognition.cancel,"recognition-cancel")}
        <Pressable accessibilityRole="button" accessibilityLabel={card.recognition.cropLabel} disabled={card.recognition.disabled || !card.recognition.preview || box.w < .05 || box.h < .05} onPress={() => onCrop(box)} style={{ minHeight:38,borderColor:primary,borderWidth:1,borderRadius:7,paddingHorizontal:10,justifyContent:"center" }}><Text style={{color:"#eee",fontSize:12}}>{card.recognition.cropLabel}</Text></Pressable></View>
    </View>}
    {renderSelect("gate-destination")}
    {card.siteLoading && <ActivityIndicator accessibilityLabel={card.es ? "Cargando sitio" : "Loading site"} color={primary} />}
    <View style={{ flexDirection: "row", gap: 8 }}>{renderSelect("gate-purpose")}</View>
    {renderField("gate-notes")}
  </View>;
}
