export function calendarWorkerScope(session:{userId:number;role:string;membershipRole?:string|null;vendorRole?:string|null}, requested?:number) {
  const personal=session.role!=='admin'&&session.membershipRole!=='admin'&&(session.vendorRole==='gatekeeper'||session.role==='field_employee');
  if(personal&&requested!==undefined&&requested!==session.userId) throw Object.assign(Error('Own calendar only'),{status:403});
  return personal?session.userId:requested;
}
