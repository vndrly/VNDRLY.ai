import type {LibraryMetadata} from '@workspace/api-zod';
import context from '../data/training-qualification-context.json';

/** Current role requirements sit beside immutable learning records. Reading this
 * context never changes lesson answers, completed versions, scores or credentials. */
export function trainingQualificationContext(metadata: Pick<LibraryMetadata,'kind'|'safetyResource'>) {
  if (metadata.kind !== 'training' || !metadata.safetyResource || metadata.safetyResource.resourceType !== 'training') return [];
  const family = metadata.safetyResource.familyId;
  return Object.hasOwn(context, family) ? structuredClone(context[family as keyof typeof context]) : [];
}
