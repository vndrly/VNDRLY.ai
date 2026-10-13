export type GateLogRow=Record<string,unknown>&{id?:string|number};
export function gateVisitState(row:GateLogRow):"review"|"pending"|"denied"|"reconciled"|"departed"|"on_site"{
 if(row.reconciliationState==="needs_review")return "review";
 if(row.admissionStatus==="pending")return "pending";
 if(row.admissionStatus==="denied")return "denied";
 if(row.reconciliationState==="confirmed_off_site")return "reconciled";
 return row.checkOutTime?"departed":"on_site";
}
export function gateVisitDuration(row:GateLogRow,now=Date.now()):number|null{
 const start=Date.parse(String(row.checkInTime??"")),state=gateVisitState(row);if(!Number.isFinite(start)||["pending","denied","reconciled"].includes(state))return null;
 const end=row.checkOutTime?Date.parse(String(row.checkOutTime)):now;if(!Number.isFinite(end)||end<start)return null;return Math.floor((end-start)/60000);
}
export function groupGateVisits(rows:GateLogRow[]){const groups=new Map<string,GateLogRow[]>();for(const row of rows.slice().sort((a,b)=>(Date.parse(String(b.checkInTime))||0)-(Date.parse(String(a.checkInTime))||0))){const date=new Date(String(row.checkInTime??"")),key=Number.isFinite(date.getTime())?date.toLocaleDateString():"unknown";groups.set(key,[...(groups.get(key)??[]),row]);}return [...groups.entries()];}
