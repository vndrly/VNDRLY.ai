import {z} from "zod/v4";
const timezone=z.string().min(1).max(100).refine(value=>{try{new Intl.DateTimeFormat("en",{timeZone:value});return true;}catch{return false;}},"Unknown time zone");
export const FormCampaignConfigSchema=z.object({
 kind:z.enum(["acknowledgement","poll","form"]),title:z.string().trim().min(1).max(200),description:z.string().max(20000).default(""),
 policyText:z.string().max(50000).default(""),policyVersion:z.string().trim().max(80).default("1"),policyAttachmentId:z.uuid().nullable().default(null),
 choices:z.array(z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),label:z.string().trim().min(1).max(300)})).max(20).default([]),maxSelections:z.number().int().min(1).max(20).default(1),anonymous:z.boolean().default(false),allowVoteChanges:z.boolean().default(false),resultsTiming:z.enum(["live","at_close"]).default("at_close"),
 audience:z.object({mode:z.enum(["all_active","selected"]).default("all_active"),userIds:z.array(z.number().int().positive()).max(5000).default([]),rolling:z.boolean().default(false)}).default({mode:"all_active",userIds:[],rolling:false}),
 durationHours:z.number().int().min(1).max(8760).optional(),timezone:timezone.default("America/Chicago"),reminderHours:z.number().int().min(1).max(720).nullable().default(null),
 briefing:z.object({enabled:z.boolean().default(false),hour:z.number().int().min(0).max(23).default(8),minute:z.number().int().min(0).max(59).default(0),push:z.boolean().default(false)}).default({enabled:false,hour:8,minute:0,push:false}),
 escalation:z.object({userId:z.number().int().positive(),delayHours:z.number().int().min(1).max(720)}).nullable().default(null)
}).superRefine((c,ctx)=>{
 if(c.kind==="acknowledgement"&&c.anonymous)ctx.addIssue({code:"custom",message:"Policy acknowledgements must be named"});
 if(c.audience.mode==="selected"&&!c.audience.userIds.length)ctx.addIssue({code:"custom",message:"Choose at least one recipient"});
 if(c.kind==="poll"&&(c.choices.length<2||c.maxSelections>c.choices.length))ctx.addIssue({code:"custom",message:"A poll requires at least two choices and a valid selection limit"});
 if(new Set(c.choices.map(x=>x.id)).size!==c.choices.length)ctx.addIssue({code:"custom",message:"Choice IDs must be unique"});
});
export type FormCampaignConfig=z.infer<typeof FormCampaignConfigSchema>;
export const FormCampaignStateSchema=z.object({status:z.enum(["draft","published","closed","paused"]).default("draft"),version:z.number().int().nonnegative().default(0),publishedAt:z.iso.datetime().nullable().default(null),deadline:z.iso.datetime().nullable().default(null),nextReminderAt:z.iso.datetime().nullable().default(null),nextAudienceAt:z.iso.datetime().nullable().default(null),lastBriefingDate:z.string().nullable().default(null),lastReminderAt:z.iso.datetime().nullable().default(null),closedAt:z.iso.datetime().nullable().default(null),deadlineNotifiedAt:z.iso.datetime().nullable().default(null),escalatedAt:z.iso.datetime().nullable().default(null)});
export type FormCampaignState=z.infer<typeof FormCampaignStateSchema>;
export const FormCampaignResponseSchema=z.object({acknowledged:z.boolean().optional(),choices:z.array(z.string()).max(20).optional(),values:z.record(z.string(),z.unknown()).optional()});
export const FormCampaignReceiptSchema=z.object({campaignId:z.uuid(),instanceId:z.uuid(),submissionId:z.uuid(),submittedAt:z.iso.datetime(),late:z.boolean(),version:z.number().int().positive(),policyVersion:z.string().nullable()});
