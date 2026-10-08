import {Router} from "express";
import {z} from "zod/v4";
import {getSessionFromRequest} from "../lib/session";
import {GateIdentityError,readGateIdentity,saveGateIdentity} from "../services/gate-identity";
const router=Router();
router.all("/visits/gate/:id/identity-document",async(req,res)=>{
  const session=getSessionFromRequest(req);if(!session){res.status(401).json({message:"Login required"});return;}
  try{
    const id=z.coerce.number().int().positive().parse(req.params.id);
    if(req.method==="GET"){res.setHeader("Cache-Control","private, no-store");res.json(await readGateIdentity(session,id));}
    else if(req.method==="POST")res.status(201).json(await saveGateIdentity(session,id,req.body));
    else res.sendStatus(405);
  }catch(error){res.status(error instanceof GateIdentityError?error.status:error instanceof z.ZodError?400:403).json({message:error instanceof GateIdentityError?error.message:"Identity document unavailable"});}
});
export default router;
