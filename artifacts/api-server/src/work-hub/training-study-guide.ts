import {and,eq,sql,inArray} from 'drizzle-orm';
import {db,workHubFormTemplatesTable as templates} from '@workspace/db';
import {libraryRecord,LibraryError,type LibraryActor} from './library-core';
import {trainingReadContent} from './library-policy';
import {trainingCatalog} from '../lib/company-required-training';
import {buildTrainingCourseGuide,relatedCourseFamilies} from '../lib/training-course-guide';

export async function trainingStudyGuide(actor:LibraryActor,itemId:string){
 const own=await libraryRecord(db,actor,itemId);
 if(own.metadata.state!=='published'||own.metadata.kind!=='training')throw new LibraryError('Published training course required',400);
 const content=trainingReadContent(own.metadata);if(!content?.training)throw new LibraryError('Training material unavailable',404);
 const familyId=own.metadata.safetyResource?.familyId??'',reference=trainingCatalog.curriculum.find(c=>c.id===familyId);
 const guide=buildTrainingCourseGuide(content,familyId,reference?.purpose??'');
 const relatedIds=relatedCourseFamilies[familyId]??[];
 const candidates=relatedIds.length?await db.select({itemId:templates.id,title:templates.name,version:templates.currentVersion,familyId:sql<string>`${templates.libraryMetadata}->'safetyResource'->>'familyId'`}).from(templates).where(and(eq(templates.ownerOrgType,own.owner.type),eq(templates.ownerOrgId,own.owner.id),sql`${templates.libraryMetadata}->>'kind'='training' AND ${templates.libraryMetadata}->>'state'='published'`,inArray(sql`${templates.libraryMetadata}->'safetyResource'->>'familyId'`,relatedIds))):[];
 const related=relatedIds.flatMap(id=>{const item=candidates.filter(c=>c.familyId===id).sort((a,b)=>b.version-a.version)[0];return item?[{itemId:item.itemId,familyId:id,title:item.title}]:[];});
 return {content,guide:{...guide,itemId,familyId,contentVersion:own.metadata.contentVersion,studyUrl:`/api/work-hub/library/${itemId}/study-guide.pdf`,related}};
}

export {renderTrainingStudyPdf} from '../lib/training-study-pdf';
