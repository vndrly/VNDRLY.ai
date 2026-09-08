import { z } from "zod/v4";
const voiceMetadataSchema = z.object({ durationMs: z.number().int().positive().max(86_400_000), container: z.string().trim().min(1).max(20), codec: z.string().trim().min(1).max(40), waveform: z.array(z.number().min(0).max(1)).min(1).max(2000) });
export type VoiceNoteMetadata = z.infer<typeof voiceMetadataSchema>;
export function validateVoiceNoteMetadata(input: unknown): VoiceNoteMetadata { return voiceMetadataSchema.parse(input); }
