import { useEffect, useState, type ReactNode } from "react";
/** The fixed slot reserves badge space even at zero, keeping every title aligned. */
export function CommsUnreadIcon({children, count = 0, label}: {children:ReactNode;count?:number;label:string}) {
 return <i className="hub-comms-icon-slot">{children}{count>0&&<b className="hub-comms-unread-badge" aria-label={`${count} unread ${label}`}>{count>99?"99+":count}</b>}</i>;
}

// Only sources without a provider read receipt use a private, device-local seen record.
export function useCommsSeen(scope:string, kind:string) {
 const key=`comms-seen:${scope}:${kind}`;
 const read=():string[]=>{try{return JSON.parse(localStorage.getItem(key)||"[]");}catch{return [];}};
 const [seen,setSeen]=useState<string[]>(read);
 useEffect(()=>{const sync=()=>setSeen(read());sync();window.addEventListener("comms-seen",sync);return()=>window.removeEventListener("comms-seen",sync);},[key]);
 return {seen,markSeen:(id:string)=>{const next=[...new Set([...read(),id])];try{localStorage.setItem(key,JSON.stringify(next));}catch{}setSeen(next);window.dispatchEvent(new Event("comms-seen"));}};
}
