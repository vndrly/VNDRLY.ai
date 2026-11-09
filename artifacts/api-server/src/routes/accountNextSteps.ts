import { Router } from "express";
import { getSessionFromRequest } from "../lib/session";
import { ChangeOverError } from "../services/gate-change-over";
import { readAccountNextSteps, saveAccountCoi } from "../services/account-next-steps";
const router = Router();
router.get("/account-next-steps", async (req,res,next) => {
  res.setHeader("Cache-Control","private, no-store");
  const session=getSessionFromRequest(req);
  if (!session?.userId) { res.status(401).json({message:"Sign in required"}); return; }
  const expected = [req.get("X-VNDRLY-Actor-User"), req.get("X-VNDRLY-Vendor"), req.get("X-VNDRLY-Membership")];
  if (expected.some(value => value !== undefined) && expected.some((value, index) => value !== String([session.userId, session.vendorId, session.activeMembershipId][index]))) {
    res.status(409).json({message:"Your account changed. Refresh Next Steps in the current company.", code:"workforce.context_changed"}); return;
  }
  try { res.json(await readAccountNextSteps(session)); }
  catch(error) { if(error instanceof ChangeOverError) res.status(error.status).json({message:error.message,code:error.code}); else next(error); }
});
router.post('/account-next-steps/coi',async(req,res,next)=>{
  res.setHeader('Cache-Control','private, no-store');
  const session=getSessionFromRequest(req);
  if(!session?.userId){res.status(401).json({message:'Sign in required'});return;}
  if(req.body?.vendorId!==session.vendorId){res.status(409).json({message:'Your company changed. Return to the original company before saving this COI.'});return;}
  if(typeof req.body?.objectPath!=='string'){res.status(400).json({message:'Choose a finalized COI upload.'});return;}
  try{res.json(await saveAccountCoi(session,req.body.objectPath));}
  catch(error){if(error instanceof ChangeOverError)res.status(error.status).json({message:error.message,code:error.code});else next(error);}
});
export default router;
