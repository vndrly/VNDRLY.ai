import DismissibleModal from "./DismissibleModal";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import React, { useState } from "react";
import { View, Text} from "react-native";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { updatePreferredLanguage } from "@/lib/api";
import TogglePillButton from "@/components/TogglePillButton";

export default function FirstLoginLanguage() {
  const { user, requiresContextChoice } = useAuth();
  const brand = useBrand();
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [language,setLanguage]=useState<"en"|"es">("en"),[menuOpen,setMenuOpen]=useState(false);
  const open=Boolean(user?.needsLanguageChoice && !user.mustChangePassword && !requiresContextChoice && dismissed!==user.id);
  async function save(language:"en"|"es",dismiss=false) {
    if (!user || busy) return;
    const id=user.id;
    if(dismiss)setDismissed(id);
    setBusy(true);setError("");
    try { await updatePreferredLanguage(language);setDismissed(id); }
    catch { setError("Language could not be saved. You can change it in Profile settings."); }
    finally {setBusy(false);}
  }
  if (!open) return null;
  return <DismissibleModal visible transparent animationType="fade" onRequestClose={()=>void save("en",true)}>
    <View style={{flex:1,justifyContent:"center",padding:24,backgroundColor:"#0009"}}>
      <View accessibilityViewIsModal style={{padding:20,gap:16,borderWidth:2,borderColor:brand.primary,borderRadius:12,backgroundColor:"#242426"}}>
        <Text accessibilityRole="header" style={{fontSize:22,fontWeight:"700",color:"#f8fafc"}}>Choose your language</Text>
        <Text style={{color:"#f8fafc"}}>English is the default. You can change your language later in Profile settings.</Text>
        <Text style={{color:"#f8fafc"}}>Language</Text>
        <Pressable accessibilityRole="combobox" accessibilityLabel="Language" accessibilityState={{expanded:menuOpen,disabled:busy}} disabled={busy} onPress={()=>setMenuOpen(value=>!value)} style={{minHeight:44,paddingHorizontal:16,justifyContent:"center",borderWidth:1,borderColor:brand.primary,borderRadius:24,backgroundColor:"#303034"}}>
          <Text style={{color:"#f8fafc"}}>{language==="en"?"English":"Español"} ▾</Text>
        </Pressable>
        {menuOpen && <View style={{borderWidth:1,borderColor:brand.primary,borderRadius:8,backgroundColor:"#303034"}}>
          {([{code:"en",label:"English"},{code:"es",label:"Español"}] as const).map(option=><Pressable key={option.code} accessibilityRole="button" accessibilityState={{selected:language===option.code}} onPress={()=>{setLanguage(option.code);setMenuOpen(false);}} style={{minHeight:44,paddingHorizontal:16,justifyContent:"center"}}><Text style={{color:"#f8fafc"}}>{option.label}</Text></Pressable>)}
        </View>}
        <TogglePillButton color="brand" disabled={busy} onPress={()=>void save(language)}>{busy?"Saving…":"Continue"}</TogglePillButton>
        {error ? <Text accessibilityRole="alert" style={{color:"#f8fafc"}}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={busy} onPress={()=>void save("en",true)} style={{minHeight:44,justifyContent:"center"}}><Text style={{color:"#f8fafc",textDecorationLine:"underline"}}>Close</Text></Pressable>
      </View>
    </View>
  </DismissibleModal>;
}
