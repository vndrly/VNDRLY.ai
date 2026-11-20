import {z} from 'zod/v4';
/** Display copy shared by web and native; stored evidence and identifiers remain intact. */
export function catalogDisplayTitle(value:string):string {
 return value.replace(/^\s*#{1,6}\s*/, '')
  .replace(/\s*[—–-]\s*(?:learner and delivery guide|program and instructor guide|(?:complete\s+)?learner(?: and tester)? coursebook)\s*$/i,'')
  .replace(/^Integrated learner exercise:\s*/i,'Practical exercise: ')
  .replace(/\s*[—–]\s*/g, ': ')
  .replace(/\s+#+\s*$/,'').trim();
}
const course=z.object({id:z.string(),title:z.string(),sources:z.array(z.string()),percent:z.number(),completedAt:z.string().nullable(),score:z.number().nullable(),benchmarks:z.array(z.object({id:z.string(),title:z.string(),complete:z.boolean(),reviewedAt:z.string().nullable()}))});
export const CatalogProfileSchema=z.object({programs:z.array(z.object({id:z.string(),title:z.string(),percent:z.number(),complete:z.boolean(),expiresAt:z.string().nullable(),awardedAt:z.string().nullable(),score:z.number().nullable(),certNumber:z.string().optional(),profileHidden:z.boolean().optional(),courses:z.array(course)})),courses:z.array(course)});
export type CatalogProfile=z.infer<typeof CatalogProfileSchema>;
export const CatalogCredentialEditSchema=z.object({
 certNumber:z.string().trim().max(200),
 awardedAt:z.iso.date().nullable(),
 expiresAt:z.iso.date().nullable(),
}).strict().refine(value=>!value.awardedAt||!value.expiresAt||value.expiresAt>=value.awardedAt,{message:'Expiration must be on or after completion',path:['expiresAt']});
