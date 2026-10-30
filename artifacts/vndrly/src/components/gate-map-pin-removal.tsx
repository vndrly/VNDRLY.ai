import { useState } from "react";
import { Trash2 } from "lucide-react";

export function GateMapPinRemoval({ es, pending, onRemove }: { es:boolean; pending:boolean; onRemove:()=>Promise<void> }) {
  const [confirming,setConfirming]=useState(false);
  const t=(en:string,spanish:string)=>es?spanish:en;
  if (!confirming) return <button type="button" className="gate-map-pin-remove" onClick={()=>setConfirming(true)} disabled={pending}><Trash2 aria-hidden="true" />{t("Remove Pin","Eliminar pin")}</button>;
  return <div className="gate-map-pin-confirm">
    <p role="alert">{t("Are you sure? This removes the pin for everyone in your company.","¿Está seguro? Se eliminará el pin para toda su empresa.")}</p>
    <div><button type="button" className="gate-map-pin-remove" disabled={pending} onClick={()=>void onRemove()}>{pending?t("Removing…","Eliminando…"):t("Yes, remove","Sí, eliminar")}</button>
    <button type="button" className="gate-map-pin-remove" disabled={pending} onClick={()=>setConfirming(false)}>{t("Cancel","Cancelar")}</button></div>
  </div>;
}
