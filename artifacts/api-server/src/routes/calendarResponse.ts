import {Router} from "express";
import {ZodError} from "zod/v4";
import {getSessionFromRequest} from "../lib/session";
import {calendarResponseForSession} from "../services/calendar-response-repository";
const router=Router();
router.get("/work-hub/calendar-response/:occurrenceId/snapshot",async(req,res)=>{
 const session=getSessionFromRequest(req);if(!session){res.status(401).json({error:"Unauthorized"});return;}
 try{res.json(await calendarResponseForSession(session).inspect(req.params.occurrenceId));}catch(error){res.status(error instanceof ZodError?400:403).json({error:"Calendar response unavailable"});}
});
for(const action of ["execute","readback"] as const)router.post(`/work-hub/calendar-response/${action}`,async(req,res)=>{
 const session=getSessionFromRequest(req);if(!session){res.status(401).json({error:"Unauthorized"});return;}
 try{res.json(await calendarResponseForSession(session)[action](req.body));}catch(error){const message=error instanceof Error?error.message:"";res.status(error instanceof ZodError?400:["calendar.operation_conflict","calendar.snapshot_conflict","calendar.terminal_occurrence"].includes(message)?409:403).json({error:"Calendar response unavailable"});}
});
export default router;
