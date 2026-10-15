export function voicemailRetryPlan(attempts: number, now = Date.now()) {
  return attempts < 3 ? {state:"retry",nextAt:new Date(now+(attempts <= 1 ? 5000 : 30000))} : {state:"failed",nextAt:null};
}
