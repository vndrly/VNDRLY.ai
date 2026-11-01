export function streamlineCourseContent<T>(content:T,id:string,originalBoundary?:string,preserveAssessment?:boolean):T;
export function streamlineBody(body:string):string;
export function removeAccreditationDisclaimers<T>(content:T):T;
export function cleanTrainingText(text:string):string;
export function legalBoundary(id:string):string[];
export const legalTaskRequirements:Array<{id:string;courses:string[];citation:string;appliesTo:string;requirement:string;url:string}>;
