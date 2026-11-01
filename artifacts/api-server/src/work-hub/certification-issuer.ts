import {LibraryDraftSchema,type LibraryMetadata} from '@workspace/api-zod';
import {safetyTrainingCatalog} from '../data/safety-training-catalog';
import {safetyTrainingContentHash} from '../lib/safety-training-content-hash';
type RegistryCourse={id:string;sourceSha256:string;contentSha256:string};
/** Metadata labels are not issuer evidence: verify the entire normalized course,
 * including the server-only answer bank, against the generated trusted registry. */
export function isCanonicalEnergySafetyCourse(metadata:LibraryMetadata,registry:readonly RegistryCourse[]=(safetyTrainingCatalog as {curriculum:RegistryCourse[]}).curriculum){
 const trusted=registry.find(course=>course.id==='G99');
 if(!trusted||metadata.safetyResource?.familyId!=='G99'||metadata.safetyResource.sourceSha256!==trusted.sourceSha256)return false;
 const content=LibraryDraftSchema.safeParse(metadata.content);
 return content.success&&!!content.data.training?.certificationExam&&safetyTrainingContentHash(content.data)===trusted.contentSha256;
}
