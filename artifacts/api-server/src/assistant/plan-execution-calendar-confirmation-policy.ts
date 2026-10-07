import { z } from "zod/v4";
export const CALENDAR_CONFIRMATION_ARGUMENTS=z.object({occurrenceId:z.uuid(),expectedFingerprint:z.string().regex(/^[a-f0-9]{64}$/),deadlineAt:z.iso.datetime()}).strict();
